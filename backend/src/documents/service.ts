// ---------------------------------------------------------------------------
// Servicio de documentos.
//
// La autorizacion esta en las funciones de SQL (02i), igual que en el resto de
// bloques: pertenencia, visibilidad por rol, ACL y borrado ADMIN viven DENTRO
// de la transaccion, en el unico sitio donde el motor las ve. Aqui no hay
// ningun `if (rol === ...)`: seria una segunda copia de una regla que ya esta
// escrita y probada en SQL.
//
// Lo que hace este servicio, y que no hace ninguno de los anteriores, es
// orquestar el CICLO DE VIDA DEL OBJETO en Storage, porque para los demas
// modulos no existe el dato fuera de la fila:
//
//   - Alta: se SUBE el objeto antes de insertar la fila, y si el INSERT
//     falla se borra el objeto (compensacion, DN-13). El resumen del fichero
//     (checksum SHA-256) tambien sale de aqui (DN-12: del binario, no de lo
//     que diga el cliente).
//   - Descarga: llamada DOBLE a `app_document_storage_path()` (spec §5.5).
//     Con false -> null = 404; con true -> null = 403. El `expiresIn` es del
//     env y la URL la firma el driver de Storage.
//   - Borrado: la ruta del bucket se captura ANTES del soft delete (tras el,
//     la funcion ya no la devuelve, DN-11), y el objeto se elimina DESPUES,
//     cuando el soft delete ya esta commiteado. Si esa eliminacion falla,
//     queda un residuo logueado que un job de limpieza futuro puede recoger —
//     nunca se deshace el soft delete, que es el dato.
// ---------------------------------------------------------------------------

import { createHash, randomUUID } from 'node:crypto'
import { withContext } from '../context.js'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { forbidden, notFound } from '../http/errors.js'
import { getStorageGateway } from './storage/index.js'
import type { DocumentCategory, MinRole } from './repository.js'
import * as repo from './repository.js'
import { ejecuta } from './errors.js'
import type { CreateDocumentInput, ListQueryInput } from './validators.js'

/**
 * El documento tal como sale en la API (spec 08 §7.1).
 *
 * `mimeType` y `checksum` se exponen a proposito: el frontend puede pintar un
 * icono por extension/mime y deduplicar campos con el hash. La ruta del bucket
 * NO sale nunca: `storage_path` ni siquiera viaja en las columnas de la funcion
 * de lectura (comentario de 02i §3); quien descarga usa la signed URL.
 *
 * Los instantes van como ISO 8601 UTC, el mismo formato que entra en el resto
 * de modulos.
 */
export type DocumentView = {
  id: string
  communityId: string
  title: string
  description: string | null
  category: DocumentCategory
  mimeType: string
  sizeBytes: number
  checksum: string
  minRole: MinRole
  isPublic: boolean
  uploadedBy: string | null
  uploadedByName: string | null
  createdAt: string
  updatedAt: string
}

export type DocumentListView = {
  items: DocumentView[]
  meta: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export interface FicheroSubido {
  buffer: Buffer
  mimetype: string
}

function toView(row: repo.DocumentRow): DocumentView {
  // `revalida()` del repository ya recuso cualquier valor que no sea un enum
  // de los de 01_schema; este cast solo materializa esa garantia en el tipo.
  const fila = row as repo.DocumentoConcreto

  return {
    id: fila.id,
    communityId: fila.community_id,
    title: fila.title,
    description: fila.description,
    category: fila.category,
    mimeType: fila.mime_type,
    sizeBytes: Number(fila.size_bytes),
    checksum: fila.checksum,
    minRole: fila.min_role,
    isPublic: fila.is_public,
    uploadedBy: fila.uploaded_by,
    uploadedByName: fila.uploaded_by_name,
    createdAt: fila.created_at.toISOString(),
    updatedAt: fila.updated_at.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/**
 * Listar los documentos de una comunidad, o buscar por id (DN-6: misma consulta
 * en los dos casos).
 *
 * `requireCommunity()` de la ruta comprueba la membresia, y el hueco entre "es
 * miembro" y "que documentos ve" lo decide `app_list_documents()` dentro de la
 * consulta: ADMIN ve todos, la ACL explícita vale para cualquier rol activo, la
 * visibilidad por rol excluye a PROVIDER (DN-5), y los borrados no los ve nadie
 * (DN-11). Nada de eso se reimplementa aqui.
 *
 * El `total_count` trae el mismo problema de pagina vacia que avisos (AN-8):
 * `count(*) over ()` se evalua sobre las filas que salen, y una pagina mas alla
 * del final no sale ninguna. Cuando pasa —y solo si `offset > 0`— se pide una
 * fila de la primera pagina a la MISMA funcion con los mismos filtros, en la
 * misma transaccion, para traer el total real.
 */
export async function listDocuments(
  userId: string,
  communityId: string,
  query: ListQueryInput,
): Promise<DocumentListView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const page = query.page ?? 1
      const limit = query.limit ?? 20
      const offset = (page - 1) * limit

      const filtros = {
        category: query.category,
        q: query.q,
      }

      const rows = await repo.listDocuments(tx, communityId, { ...filtros, limit, offset })

      let total = 0
      const primera = rows[0]

      if (primera) {
        total = Number(primera.total_count)
      } else if (offset > 0) {
        const muestra = await repo.listDocuments(tx, communityId, { ...filtros, limit: 1, offset: 0 })
        const primeraMuestra = muestra[0]
        total = primeraMuestra ? Number(primeraMuestra.total_count) : 0
      }

      return {
        items: rows.map(toView),
        meta: {
          page,
          limit,
          total,
          totalPages: total === 0 ? 0 : Math.ceil(total / limit),
        },
      }
    }),
  )
}

/**
 * Un documento por id (GET /documents/:id).
 *
 * Sin `communityId` en la URL: el predicado de `app_list_documents()` con
 * `p_document` puesto decide la visibilidad sin necesidad de contexto previo
 * (misma fisonomia que el detalle de avisos). Si la funcion no devuelve la
 * fila, el documento no existe, es de otra comunidad, esta borrado o este rol
 * no lo ve — los cuatro acaban en el MISMO 404, por C-8: un 403 confirmaria
 * que el id existe.
 */
export async function getDocument(userId: string, documentId: string): Promise<DocumentView> {
  return ejecuta(() =>
    withContext({ userId, communityId: null }, async (tx) => {
      const row = await repo.findDocument(tx, documentId)

      if (!row) {
        throw notFound('Ese documento no existe o no es visible.')
      }

      return toView(row)
    }),
  )
}

// ---------------------------------------------------------------------------
// Descarga
// ---------------------------------------------------------------------------

/**
 * La signed URL de un documento (DN-10) y su validez en segundos.
 *
 * Los DOS pasos de la spec §5.5:
 *
 *   1. `app_document_storage_path(id, false)` -> NULL es 404. NO existe
 *      la llamada que distinga "no existe" de "no lo ves" (confirmar la
 *      existencia es el leak que C-8 prohibe).
 *   2. `app_document_storage_path(id, true)`  -> NULL es 403: lo ve, pero
 *      no puede bajar el binario (can_download=false en la ACL, o rol sin
 *      umbral). El 403 aqui ya no filtra nada: el paso 1 probaba visibilidad.
 *
 * La URL se firma FUERA de la transaccion de base de datos: la ruta ya es lo
 * unico que se consulta, y mantener una conexion abierta mientras se habla con
 * el provedor de storage es gastarla sin necesidad.
 */
export async function downloadDocument(userId: string, documentId: string): Promise<{ url: string; expiresIn: number }> {
  return ejecuta(async () => {
    const storagePath = await withContext({ userId, communityId: null }, async (tx) => {
      const path = await repo.documentStoragePath(tx, documentId, false)

      if (!path) {
        throw notFound('Ese documento no existe o no es visible.')
      }

      const downloadPath = await repo.documentStoragePath(tx, documentId, true)

      if (!downloadPath) {
        throw forbidden('No tienes permiso para descargar este documento.')
      }

      return downloadPath
    })

    const gateway = await getStorageGateway()
    const url = await gateway.signedUrl(storagePath, env.DOCUMENTS_SIGNED_URL_EXPIRES_IN)

    return { url, expiresIn: env.DOCUMENTS_SIGNED_URL_EXPIRES_IN }
  })
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

/**
 * Alta de un documento (DN-1, solo ADMIN; el guard de la ruta y la funcion lo
 * repiten dentro de la transaccion).
 *
 * El orden es CICLICO y no es decorativo (DN-13):
 *
 *   1. Se sube el objeto al bucket con la ruta `<community_id>/<uuid v4>`.
 *      Nada de insertar primero: una fila cuya ruta no existe en el bucket es
 *      un documento que se ve pero no se puede descargar.
 *   2. Se inserta la fila. Si el INSERT falla (por lo que sea: rol, unique,
 *      CHECK), se borra el objeto y se relanza. Ese borrado es best-effort:
 *      si falla, queda un residuo y el log lo dice; el cliente ya ha recibido
 *      el error del paso 2.
 *   3. Se relee la fila con `findDocument()` (DN-3): la respuesta sale de una
 *      lectura, con los `coalesce` y `btrim` ya aplicados, no de los
 *      parametros de entrada.
 *
 * El checksum SHA-256 sale del binario (DN-12). `size_bytes` se toma del
 * buffer. `mimeType` y `mimetype` del request es el mime declarado, ya
 * comprobado contra la lista de `03_storage.sql` en el controller.
 */
export async function createDocument(
  userId: string,
  communityId: string,
  input: CreateDocumentInput,
  file: FicheroSubido,
): Promise<DocumentView> {
  const gateway = await getStorageGateway()
  const storagePath = `${communityId}/${randomUUID()}`
  const checksum = createHash('sha256').update(file.buffer).digest('hex')
  const sizeBytes = file.buffer.byteLength

  return ejecuta(async () => {
    // Subida FUERA de la transaccion, por el mismo motivo que la firma de la
    // descarga: mantener una conexion abierta mientras se habla con el
    // provedor de storage es gastarla sin necesidad.
    await gateway.upload(storagePath, file.buffer, file.mimetype)

    let row: repo.DocumentRow | null

    try {
      row = await withContext({ userId, communityId }, async (tx) => {
        const id = await repo.createDocument(tx, communityId, {
          title: input.title,
          description: input.description ?? null,
          category: input.category ?? null,
          storagePath,
          mimeType: file.mimetype,
          sizeBytes,
          checksum,
          minRole: input.minRole ?? null,
          isPublic: input.isPublic ?? null,
          acl: input.acl,
        })

        // La relectura (DN-3) en la MISMA transaccion que el insert.
        return repo.findDocument(tx, id)
      })
    } catch (error) {
      // Compensacion (DN-13): el INSERT fallo, asi que el objeto que acaba de
      // subirse no tiene fila que lo justifique. Best-effort: si el borrado
      // falla, queda un residuo logueado; el cliente ya recibe el error del
      // insert.
      logger.warn({ storagePath }, 'alta de documento: compensación, se borra el objeto del bucket')
      await gateway.remove(storagePath).catch((fallo) => {
        logger.warn({ error: fallo, storagePath }, 'fallo al borrar el objeto durante la compensación')
      })
      throw error
    }

    if (!row) {
      throw new Error('El documento se creó pero no se puede leer.')
    }

    return toView(row)
  })
}

/**
 * Borrado de un documento: soft delete en la BD y eliminacion del objeto
 * despues (DN-11, y en ese orden).
 *
 *   - La ruta se captura ANTES del borrado. Tras el `deleted_at = now()`,
 *     `app_document_storage_path()` ya no la devuelve (para nadie es borrado),
 *     y sin la ruta el objeto quedaria huerfano para siempre.
 *   - Si la ruta es null al capturarla -> 404 (mismo criterio C-8).
 *   - `app_delete_document()` decide el rol: un PRESIDENT recibe
 *     `document_requires_admin` (403), y un segundo borrado recibe
 *     `document_not_found` (404), no un 200 idempotente.
 *   - Tras el commit, el objeto se borra best-effort: si falla, el residuo se
 *     loguea y un job futuro lo puede recoger (comentario de 02i §4). El 200
 *     con `{ id, deleted: true }` ya se ha ganado, porque el dato (quien y
 *     cuando borro) esta en la fila.
 */
export async function deleteDocument(userId: string, documentId: string): Promise<void> {
  const gateway = await getStorageGateway()

  // La ruta y el soft delete, en la transaccion; la eliminacion del objeto,
  // FUERA y despues: si el commit no llegara a producirse, el objeto seguiria
  // siendo el dato que el cliente ve, y borrarlo antes seria deshacer algo que
  // todavia no ocurrio.
  const storagePath = await ejecuta(() =>
    withContext({ userId, communityId: null }, async (tx) => {
      const path = await repo.documentStoragePath(tx, documentId, false)

      if (!path) {
        throw notFound('Ese documento no existe o no es visible.')
      }

      await repo.deleteDocument(tx, documentId)

      return path
    }),
  )

  await gateway.remove(storagePath).catch((error) => {
    logger.warn({ error, storagePath }, 'documento borrado, pero el objeto del bucket quedo sin eliminar')
  })
}