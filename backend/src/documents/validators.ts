// ---------------------------------------------------------------------------
// Validacion de entrada de documentos (zod).
//
// Mismas reglas de proyecto que los modulos 01-07: validacion en el borde,
// `.strict()` en todos los esquemas y mensajes en castellano. Lo propio de este
// bloque:
//
//   - Los ENUM (`category`, `minRole`) se listan aqui y no se dejan pasar como
//     texto libre: un `$queryRaw` con el valor sin castear dejaria llegar el
//     texto a `::document_category` / `::member_role`, y un valor inventado
//     reventaria con 22P02. Validarlo antes lo convierte en un 400 que nombra
//     el campo.
//   - Los limites de longitud son los MISMOS que los CHECK que 02i_documents.sql
//     añade sobre `documents` (`documents_title_length` 1-120,
//     `documents_description_length` <= 1000), no otros. Duplicarlos es
//     inevitable (el backend no puede leer constraints).
//   - El POST es multipart (DN-bloco §7.3): los campos llegan como CADENAS de
//     texto, no como JSON. Por eso `isPublic` acepta 'true'/'false' y la
//     `acl` se recibe como texto JSON que este esquema valida campo a campo.
//     El `acl` no lo revalida la funcion SQL: el zod es la fuente unica de la
//     forma (como en el resto de bloques), y la funcion se limita a `coalesce`.
//   - `minRole` admite los cuatro valores del enum `member_role`. En la
//     practica `PROVIDER` como umbral es un sinsentido (DN-5 lo excluye de la
//     visibilidad por rol), pero la columna es el enum completo y quien lo
//     fija es el ADMIN: se le deja decidir.
//
// Los campos que NO estan en el esquema estan a proposito (DN-8/DN-9):
// `uploadedBy`, `communityId`, `storagePath`, `mimeType`, `sizeBytes` y
// `checksum` no se aceptan en el cuerpo — la autoría la escribe la funcion con
// `app_current_user_id()`, y la ruta, el tipo, el peso y el hash los decide el
// backend a partir del archivo.
// ---------------------------------------------------------------------------

import { z } from 'zod'

/** Las seis categorias de `document_category` (01_schema.sql). */
export const CATEGORIAS = ['MINUTES', 'STATUTES', 'INVOICE', 'BUDGET', 'MAINTENANCE', 'OTHER'] as const

/** Los cuatro valores de `member_role` (01_schema.sql). */
export const MIN_ROLES = ['NEIGHBOR', 'PRESIDENT', 'ADMIN', 'PROVIDER'] as const

/**
 * Los MIME permitidos por el bucket `community-documents` (03_storage.sql §2),
 * copiados a mano. El backend los comprueba ANTES de llamar a Storage para que
 * el fallo sea un 400 del contrato y no un `storage/object-too-large` o un
 * rechazo del provedor (DN-13).
 */
export const MIME_PERMITIDOS: readonly string[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
]

/** El limite del bucket, 10 MB. Multer lo aplica en la subida y la parte el servicio. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024

export const MAX_FILE_MESSAGE = 'El archivo no puede pasar de 10 MB.'

/** Un archivo cuyo `mimetype` no esta en la lista de 03_storage.sql. */
export function mimePermitido(mime: string): boolean {
  return MIME_PERMITIDOS.includes(mime)
}

/**
 * Mismo criterio que los demas modulos (C-9): un id que no tiene forma de UUID
 * es una peticion mal formada, no una peticion sin permiso (400 y no 403), y
 * se comprueba antes de abrir transaccion porque un `::uuid` sobre texto
 * invalido reventaria con 22P02.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const uuidSchema = z.string().regex(UUID_RE, 'Debe ser un UUID.')

/**
 * El titulo: 1-120, como `documents_title_length`. El minimo es 1 y no 3
 * porque asi lo dice el CHECK de 02i (a diferencia de avisos, que son 3).
 */
const titulo = z
  .string()
  .trim()
  .min(1, 'El título no puede estar vacío.')
  .max(120, 'El título no puede pasar de 120 caracteres.')

/**
 * La descripcion: opcional, maximo 1000 (como `documents_description_length`),
 * y `''` se normaliza a `null` — lo que distingue "no se escribio" de "se
 * escribio vacio" ahí donde la columna es nullable.
 */
const descripcion = z
  .string()
  .trim()
  .max(1000, 'La descripción no puede pasar de 1000 caracteres.')
  .optional()
  .transform((v) => (v === undefined || v === '' ? null : v))

/**
 * `isPublic` llega como cadena en el multipart. `'true'`/`'false'` se aceptan,
 * y un booleano de verdad tambien (por si algun dia llega por otro canal). Lo
 * que no vale es un texto que no sea literalmente `true` o `false`:
 * `isPublic=true` en un multipart se enviaria como el texto "true".
 */
const isPublic = z
  .union([z.boolean(), z.literal('true'), z.literal('false')])
  .transform((v) => v === true || v === 'true')

/** Una entrada de la ACL fina (DN-9). `userId` es UUID; los dos booleanos, opcionales. */
const aclEntry = z
  .object({
    userId: z.string().regex(UUID_RE, 'Debe ser un UUID.'),
    canView: z.boolean().optional(),
    canDownload: z.boolean().optional(),
  })
  .strict()

/**
 * El `acl` viaja como texto JSON en el multipart. Se valida aqui campo a campo
 * (cada `userId`, cada booleano) y se entrega al servicio ya compilado; la
 * funcion SQL recibe el `jsonb` tal cual y solo `coalesce`a los booleanos.
 *
 * Un JSON invalido, o un JSON que no tiene la forma esperada, es un 400 con
 * mensaje propio — nunca llega al `::jsonb` a cruzar dedos.
 */
const acl = z
  .string()
  .optional()
  .transform((valor, ctx) => {
    if (valor === undefined || valor.trim() === '') return undefined

    let parseado: unknown
    try {
      parseado = JSON.parse(valor)
    } catch {
      ctx.addIssue({ code: 'custom', message: 'El campo acl debe ser un JSON válido.' })
      return z.NEVER
    }

    const resultado = z.array(aclEntry).safeParse(parseado)
    if (!resultado.success) {
      ctx.addIssue({
        code: 'custom',
        message: 'El campo acl debe ser una lista de { userId (UUID), canView?, canDownload? }.',
      })
      return z.NEVER
    }

    return resultado.data
  })

/**
 * Alta de un documento (POST multipart).
 *
 * Todo lo demas de la fila lo decide el backend a partir del archivo
 * (`storagePath` con `<community_id>/<uuid>`, `mimeType`, `sizeBytes` y el
 * `checksum` SHA-256 del binario) — DN-12/DN-13/DN-4 — y la autoria con
 * `app_current_user_id()` (DN-8). Con `.strict()`, mandar cualquiera de esos
 * campos es un 400 que lo dice.
 */
export const createDocumentSchema = z
  .object({
    title: titulo,
    description: descripcion,
    category: z.enum(CATEGORIAS).optional(),
    minRole: z.enum(MIN_ROLES).optional(),
    isPublic: isPublic.optional(),
    acl,
  })
  .strict()

/**
 * Filtros del listado. `page` y no `offset`, como en el resto: la API expone
 * `meta.page` y el servicio resta uno en un solo sitio. `q` acotado a 100
 * porque viaja dentro de un `ilike '%q%'` (parametro ligado, no inyeccion,
 * pero un texto de 50 KB si puede hacer lento). Parametros desconocidos son
 * 400 por `.strict()`.
 */
export const listQuerySchema = z
  .object({
    category: z.enum(CATEGORIAS).optional(),
    q: z.string().trim().min(1, 'La búsqueda no puede estar vacía.').max(100, 'La búsqueda no puede pasar de 100 caracteres.').optional(),
    page: z.coerce.number().int('La página debe ser un número entero.').min(1, 'La página empieza en 1.').optional(),
    limit: z.coerce.number().int('El límite debe ser un número entero.').min(1).max(100, 'El límite máximo es 100.').optional(),
  })
  .strict()

/** Los valores admitidos, para los mensajes de error de los tests. */
export const CATEGORIAS_VALIDAS = CATEGORIAS
export const MIN_ROLES_VALIDOS = MIN_ROLES

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>
export type ListQueryInput = z.infer<typeof listQuerySchema>