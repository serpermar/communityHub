// ---------------------------------------------------------------------------
// Acceso a datos de avisos.
//
// Es el unico sitio del modulo que escribe SQL. Todas las funciones reciben el
// cliente de transaccion, nunca el singleton: por construccion no se puede leer
// nada fuera del contexto de RLS.
//
// TODO de este archivo va por SQL a mano, y no es una mania:
//
//   - `app_runtime` no tiene INSERT ni UPDATE sobre `announcements` (02h los
//     revoca y elimina la politica de escritura), asi que el cliente de Prisma
//     no puede escribir en la tabla.
//   - `authorName` solo existe en `app_list_announcements()`: sale de un LEFT
//     JOIN contra `users`, que las politicas no dejan hacer desde el cliente.
//     Es la razon de AN-3: no hay `app_get_announcement()`, y las relecturas
//     (POST y PUT) vuelven por el MISMO listado con `p_announcement` puesto.
//   - La ventana de AN-4 (programado/caducado, y distinta por rol) es una
//     regla de negocio escrita en una sola funcion. Reproducirla en
//     TypeScript con `now()` del backend seria una segunda verdad: el reloj del
//     servidor Node y el de Postgres no tienen por que coincidir.
//
// Ninguna consulta lleva un valor del cliente dentro de un `Prisma.raw`: los
// nombres de columna van LITERALMENTE en la plantilla, porque en `$queryRaw`
// cualquier cosa metida en `${}` viaja como parametro ligado, no como SQL.
// ---------------------------------------------------------------------------

import { type Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

/**
 * Una fila de lectura de aviso, tal como la devuelve `app_list_announcements()`.
 *
 * Los nombres van en `snake_case` porque son los de los `returns table`. El
 * `service.ts` es quien los traduce a camelCase.
 *
 * `type` y `priority` llegan como cadena porque Postgres los devuelve como los
 * ENUM, que Prisma no tiene tipados para una consulta en crudo.
 * `author_id` y `author_name` son nullables: `author_id` lo es en la tabla y el
 * nombre desaparece si el autor se dio de baja (LEFT JOIN).
 */
export type AnnouncementRow = {
  id: string
  community_id: string
  title: string
  body: string
  type: string
  priority: string
  is_pinned: boolean
  publish_at: Date
  expires_at: Date | null
  author_id: string | null
  author_name: string | null
  created_at: Date
  updated_at: Date
}

/** La misma fila con `total_count`, que solo trae el listado (AN-8). */
export type AnnouncementListRow = AnnouncementRow & { total_count: bigint }

/**
 * Filtros del listado, ya validados por zod.
 *
 * `limit` y `offset` van SIEMPRE escritos (no los defaults de la funcion): el
 * calculo `offset = (page - 1) * limit` es del servicio, y si la funcion
 * aplicara otros defaults el segundo pedazo de pagina saldria de mas.
 */
export type FiltrosListado = {
  announcement?: string
  type?: string
  q?: string
  limit: number
  offset: number
}

/**
 * Listar los avisos de una comunidad, con los filtros de la spec §7.3.
 *
 * Toda la autorizacion esta dentro de la funcion: pertenencia (403 si no se es
 * miembro), ventana por rol (AN-4/AN-7) y borrados (AN-5). Aqui no hay ningun
 * filtro de rol, y no por descuido: reimplementarlo en TypeScript seria una
 * segunda implementacion de esa regla.
 *
 * Las columnas van LITERALES en la plantilla y no `select *`: escritas una a
 * una, un cambio en la funcion rompe el typecheck en vez de devolver las
 * columnas cruzadas en silencio. `total_count` viene de `count(*) over ()`,
 * asi que cada fila lo trae repetido; el servicio se queda con el primero.
 */
export async function listAnnouncements(
  tx: Tx,
  communityId: string,
  filtros: FiltrosListado,
): Promise<AnnouncementListRow[]> {
  return tx.$queryRaw<AnnouncementListRow[]>`
    select
      id, community_id, title, body, type, priority,
      is_pinned, publish_at, expires_at,
      author_id, author_name, created_at, updated_at, total_count
      from app_list_announcements(
        ${communityId}::uuid,
        ${filtros.announcement ?? null}::uuid,
        ${filtros.type ?? null}::announcement_type,
        ${filtros.q ?? null},
        ${filtros.limit}::integer,
        ${filtros.offset}::integer
      )
  `
}

/**
 * Un aviso concreto, o null si no existe o no es visible.
 *
 * NO es una segunda consulta: es `listAnnouncements()` con `p_announcement`
 * puesto (AN-3). Solo asi la relectura ve exactamente lo que veria el GET:
 * misma ventana, mismos borrados, mismo JOIN de `authorName`. Un
 * `select * from announcements` del backend saltaria esa regla, y un
 * `app_get_announcement()` aparte duplicaria el predicado.
 *
 * La ventana de AN-7 no puede esconder aqui el aviso recien creado o editado:
 * el POST y el PUT son de PRESIDENT/ADMIN, y a esos la ventana no se aplica.
 */
export async function findAnnouncement(
  tx: Tx,
  communityId: string,
  announcementId: string,
): Promise<AnnouncementListRow | null> {
  const rows = await listAnnouncements(tx, communityId, {
    announcement: announcementId,
    limit: 1,
    offset: 0,
  })

  return rows[0] ?? null
}

/**
 * Crear un aviso y devolver su id.
 *
 * `$queryRaw` y no `$executeRaw` porque la funcion devuelve `uuid`. Los campos
 * ausentes del POST los decide la funcion con los mismos `coalesce` que los
 * defaults de la columna, para que "no lo mandaste" y "lo mandaste igual que el
 * default" acaben en el mismo sitio.
 *
 * `authorId` no viaja (AN-9): lo escribe la funcion con
 * `app_current_user_id()`. Que el backend no tenga el campo hace imposible que
 * se equivoque al usarlo.
 *
 * No hay SELECT previo de duplicados porque no hay nada que duplicar: no
 * existe indice unico sobre el contenido (AN-11).
 */
export async function createAnnouncement(
  tx: Tx,
  communityId: string,
  input: {
    title: string
    body: string
    type?: string
    priority?: string
    isPinned?: boolean
    publishAt?: string
    expiresAt?: string | null
  },
): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    select app_create_announcement(
      ${communityId}::uuid,
      ${input.title},
      ${input.body},
      ${input.type ?? null}::announcement_type,
      ${input.priority ?? null}::announcement_priority,
      ${input.isPinned ?? null}::boolean,
      ${input.publishAt ?? null}::timestamptz,
      ${input.expiresAt ?? null}::timestamptz
    ) as id
  `

  const row = rows[0]

  if (!row?.id) {
    throw new Error('app_create_announcement() no devolvió el id')
  }

  return row.id
}

/**
 * Reescribir un aviso (PUT, AN-6).
 *
 * `$executeRaw` porque la funcion devuelve `setof announcements` y la fila se
 * relee despues con `findAnnouncement()`, dentro de la misma transaccion: la
 * respuesta sale de una lectura y no de los parametros de entrada, que es lo
 * unico que garantiza que lo que devuelve la API es lo que quedo escrito.
 *
 * `communityId` no es parametro: la comunidad la decide la propia fila, y
 * `author_id` no se toca — es AN-9, no D-3. Un PUT no puede reasignar un aviso.
 *
 * Los ocho campos van siempre: el PUT es reemplazo completo, y los obligatorios
 * ya lo exige zod antes de llegar aqui.
 */
export async function updateAnnouncement(
  tx: Tx,
  announcementId: string,
  input: {
    title: string
    body: string
    type: string
    priority: string
    isPinned: boolean
    publishAt: string
    expiresAt: string | null
  },
): Promise<void> {
  await tx.$executeRaw`
    select app_update_announcement(
      ${announcementId}::uuid,
      ${input.title},
      ${input.body},
      ${input.type}::announcement_type,
      ${input.priority}::announcement_priority,
      ${input.isPinned}::boolean,
      ${input.publishAt}::timestamptz,
      ${input.expiresAt}::timestamptz
    )
  `
}

/**
 * Borrar un aviso (soft delete, AN-5).
 *
 * Solo ADMIN lo decide la funcion: si el rol no da, levanta
 * `announcement_requires_admin` (42501 -> 403) y el `$executeRaw` revienta
 * aqui. El backend no comprueba el rol antes, porque seria una segunda copia de
 * una regla que ya esta escrita y probada en 02h.
 *
 * No devuelve nada porque `app_delete_announcement()` devuelve `void`: lo que
 * responde la API (200 con el id) lo compone el controller.
 */
export async function deleteAnnouncement(tx: Tx, announcementId: string): Promise<void> {
  await tx.$executeRaw`
    select app_delete_announcement(${announcementId}::uuid)
  `
}
