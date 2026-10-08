// ---------------------------------------------------------------------------
// Acceso a datos de documentos.
//
// Es el unico sitio del modulo que escribe SQL. Igual que announcements: todas
// las funciones reciben el cliente de transaccion, todo va por SQL a mano (las
// tablas `documents`/`document_acl` no dan escritura a app_runtime, y
// `uploaded_by_name` solo existe en `app_list_documents()`), y los nombres de
// columna van LITERALES en la plantilla — en `$queryRaw` cualquier `${}` viaja
// como parametro ligado, asi que solo los valores pueden ser variables.
//
// Dos diferencias con el modulo de avisos, ambas de la spec 08:
//
//   - El alta devuelve el id por dos vias: la funcion `app_create_document()`
//     devuelve `uuid`, y la relectura del 201 vuelve por `app_list_documents()`
//     con `p_document` puesto (DN-3: la respuesta sale de una lectura y no de
//     los parametros de entrada).
//   - El borrado necesita la ruta del bucket ANTES de borrar la fila: tras el
//     soft delete, `app_document_storage_path()` ya no la devuelve (DN-11).
// ---------------------------------------------------------------------------

import { type Prisma } from '@prisma/client'
import { MIME_PERMITIDOS, type CreateDocumentInput } from './validators.js'

type Tx = Prisma.TransactionClient

/**
 * Los ENUM de `01_schema.sql`, tal como llegan de Postgres: cadenas.
 * La API los expone tal cual (DN-7: `category` / `minRole` son codigos del
 * contrato, no etiquetas traducidas).
 */
export const DOCUMENT_CATEGORIES = ['MINUTES', 'STATUTES', 'INVOICE', 'BUDGET', 'MAINTENANCE', 'OTHER'] as const
export const MIN_ROLES = ['NEIGHBOR', 'PRESIDENT', 'ADMIN', 'PROVIDER'] as const

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number]
export type MinRole = (typeof MIN_ROLES)[number]

const CATEGORIA_VALIDADA = new Set<string>(DOCUMENT_CATEGORIES)
const MIN_ROLE_VALIDADO = new Set<string>(MIN_ROLES)

/** Asegura que un valor enum del cliente no fue salvado por la red hasta aqui. */
function esCategoria(valor: string): valor is DocumentCategory {
  return CATEGORIA_VALIDADA.has(valor)
}

function esMinRole(valor: string): valor is MinRole {
  return MIN_ROLE_VALIDADO.has(valor)
}

/**
 * Una fila de lectura de documento, tal como la devuelve `app_list_documents()`.
 *
 * Los ENUM vienen como cadena (Prisma no los tipa en una consulta en crudo) y
 * los tipos se revalidan al entrar: la funcion SQL ya los castea con `::`, asi
 * que un valor invalido reventaria de todas formas; este recheck convierte ese
 * error en una promesa con tipo correcto en vez de confiarse del esquema.
 */
export type DocumentRow = {
  id: string
  community_id: string
  title: string
  description: string | null
  category: string
  mime_type: string
  size_bytes: bigint
  checksum: string
  min_role: string
  is_public: boolean
  uploaded_by: string | null
  uploaded_by_name: string | null
  created_at: Date
  updated_at: Date
}

/** La misma fila con `total_count`, que solo trae el listado (DN-4). */
export type DocumentListRow = DocumentRow & { total_count: bigint }

export type DocumentoConcreto = DocumentRow & {
  category: DocumentCategory
  min_role: MinRole
}

/** Extiende la fila cruda con los ENUM revalidados, recusando tipos invalidos. */
function revalida(filas: DocumentListRow[]): DocumentListRow[] {
  for (const fila of filas) {
    if (!esCategoria(fila.category) || !esMinRole(fila.min_role)) {
      throw new Error('La base de datos devolvió un valor de enum desconocido: categoría o min_role.')
    }
  }
  return filas
}

/**
 * Filtros del listado, ya validados por zod. `limit`/`offset` van SIEMPRE
 * escritos: el offset lo calcula el servicio y la funcion no puede aplicar sus
 * defaults (mismo criterio que AN-8).
 */
export type FiltrosListado = {
  document?: string
  category?: DocumentCategory
  q?: string
  limit: number
  offset: number
}

/**
 * Listar los documentos de una comunidad, o buscar por id.
 *
 * Toda la autorizacion vive dentro de la funcion (DN-6): pertenencia (403 si
 * no se es miembro y se lista), visibilidad por rol, ACL y borrados. Aqui no
 * hay ningun filtro de rol, como en announcements — reimplementarlo en
 * TypeScript seria una segunda copia de la regla.
 *
 * Sin `select *`: las columnas van literales una a una, y un cambio en la
 * funcion rompe el typecheck en vez de devolver columnas cruzadas. El caso
 * `p_document` puesto es como se busca UN documento (DN-3).
 */
export async function listDocuments(
  tx: Tx,
  communityId: string,
  filtros: FiltrosListado,
): Promise<DocumentListRow[]> {
  return revalida(
    await tx.$queryRaw<DocumentListRow[]>`
      select
        id, community_id, title, description, category, mime_type,
        size_bytes, checksum, min_role, is_public,
        uploaded_by, uploaded_by_name, created_at, updated_at, total_count
        from app_list_documents(
          ${filtros.document ? null : communityId}::uuid,
          ${filtros.document ?? null}::uuid,
          ${filtros.category ?? null}::document_category,
          ${filtros.q ?? null},
          ${filtros.limit}::integer,
          ${filtros.offset}::integer
        )
    `,
  )
}

/**
 * Un documento concreto (leido desde dentro, con el predicado de la funcion),
 * o null si no existe o no es visible para este actor.
 *
 * NO es una segunda consulta: es `listDocuments()` con `p_document` puesto y
 * `communityId` en null. Asi la relectura del alta (DN-3) devuelve exactamente
 * lo que veria el GET del mismo usuario. El servicio ignora el `total_count`.
 */
export async function findDocument(tx: Tx, documentId: string): Promise<DocumentoConcreto | null> {
  const rows = await listDocuments(tx, '', { document: documentId, limit: 1, offset: 0 })
  const fila = rows[0]

  if (!fila) return null

  return { ...fila, category: fila.category as DocumentCategory, min_role: fila.min_role as MinRole }
}

export interface DatosAlta {
  title: string
  description: string | null
  category: DocumentCategory | null
  storagePath: string
  mimeType: string
  sizeBytes: number
  checksum: string
  minRole: MinRole | null
  isPublic: boolean | null
  acl: CreateDocumentInput['acl']
}

/**
 * Alta de un documento y devolución de su id.
 *
 * Los campos que el ADMIN no manda —`category` (DN-2, OTHER), `min_role`
 * (NEIGHBOR), `is_public` (false), `acl` (null)— los decide la funcion con
 * los mismos `coalesce` que los defaults de la columna, para que "no lo
 * mandaste" acabe igual que "lo mandaste como el default".
 *
 * `uploadedBy` no viaja (DN-8): lo escribe `app_current_user_id()`. Que el
 * backend no tenga el campo hace imposible que se equivoque al usarlo.
 *
 * `storagePath` (`<community>/<uuid v4>`) no colisiona en la practica, pero
 * si lo hiciera, el indice unico `documents_storage_path_uidx` lo avisaria
 * con `document_path_taken` (U0001 -> 409; no 23505, que Prisma se come).
 *
 * `$queryRaw` y no `$executeRaw` porque la funcion devuelve `uuid`.
 */
export async function createDocument(
  tx: Tx,
  communityId: string,
  input: DatosAlta,
): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    select app_create_document(
      ${communityId}::uuid,
      ${input.title},
      ${input.description},
      ${input.category}::document_category,
      ${input.storagePath},
      ${input.mimeType},
      ${input.sizeBytes}::bigint,
      ${input.checksum},
      ${input.minRole}::member_role,
      ${input.isPublic}::boolean,
      ${input.acl ? JSON.stringify(input.acl) : null}::jsonb
    ) as id
  `

  const row = rows[0]

  if (!row?.id) {
    throw new Error('app_create_document() no devolvió el id')
  }

  return row.id
}

/**
 * La ruta del objeto en el bucket, o null si no existe o no es visible.
 *
 * Dos llamadas distintas por descarga (DN-3, §5.5):
 *   - `forDownload=false` -> null: 404 (algo falla, da igual el qué);
 *   - `forDownload=true`  -> null: 403 (lo ve, pero no puede descargar).
 *
 * El DELETE la usa antes de borrar la fila: tras el soft delete la funcion ya
 * no devuelve la ruta, y el objeto del bucket se quedaría huérfano (DN-11).
 *
 * Devuelve la ruta como `string | null` con la comprobacion en TypeScript:
 * la funcion filtra, no avisa, igual que `app_document_community`.
 */
export async function documentStoragePath(
  tx: Tx,
  documentId: string,
  forDownload: boolean,
): Promise<string | null> {
  const rows = await tx.$queryRaw<Array<{ storage_path: string | null }>>`
    select app_document_storage_path(${documentId}::uuid, ${forDownload}::boolean) as storage_path
  `

  return rows[0]?.storage_path ?? null
}

/**
 * Borrar un documento (soft delete, DN-11).
 *
 * Solo ADMIN lo decide la funcion: si el rol no da, levanta
 * `document_requires_admin` (42501 -> 403) y el `$executeRaw` revienta aqui.
 * El backend no comprueba el rol antes porque ya esta escrito y probado en
 * 02i. Devuelve `void`; la API responde 200 con el id.
 */
export async function deleteDocument(tx: Tx, documentId: string): Promise<void> {
  await tx.$executeRaw`
    select app_delete_document(${documentId}::uuid)
  `
}

/** Precisamente a efectos de tests: los MIME que el bucket deja subir. */
export { MIME_PERMITIDOS }