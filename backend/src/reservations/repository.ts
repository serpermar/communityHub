// ---------------------------------------------------------------------------
// Acceso a datos de reservas.
//
// Es el unico sitio del modulo que escribe SQL. Todas las funciones reciben el
// cliente de transaccion, nunca el singleton: por construccion no se puede leer
// nada fuera del contexto de RLS.
//
// TODO de este archivo va por SQL a mano, sin excepciones, y no es una mania:
//
//   - `app_runtime` no tiene INSERT ni UPDATE sobre `reservations` ni sobre
//     `area_slots` (02g los revoca), asi que el cliente de Prisma no puede
//     escribir en las dos tablas que sostienen el bloque.
//   - Las lecturas necesitan `user_name`, `common_area_name` y
//     `community_name`, que salen de otras tablas, y la REDACCION de `notes`
//     (R-5) vive dentro de las funciones: RLS no redacta columnas.
//   - El listado necesita filtros por dia LOCAL de la comunidad, que es un
//     calculo sobre `communities.timezone` y no un `where` de TypeScript.
//
// Las tres escrituras (crear, confirmar, cancelar) van por su funcion: son las
// tres operaciones que tocan `area_slots`, y el indice unico del solape es quien
// decide quien gana. Un `create` de Prisma contra la tabla no existiria (sin
// permiso), y si existiera no seria atomico contra ese indice.
//
// Ninguna consulta lleva un valor del cliente dentro de un `Prisma.raw`: los
// nombres de columna van LITERALMENTE en la plantilla, porque en `$queryRaw`
// cualquier cosa metida en `${}` viaja como parametro ligado, no como SQL.
// ---------------------------------------------------------------------------

import { type Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

/**
 * Una fila de lectura de reserva, tal como la devuelven las funciones de 02g.
 *
 * Los nombres van en `snake_case` porque son los de las columnas y los de los
 * `returns table`. El `service.ts` es quien los traduce a camelCase.
 *
 * `user_name`, `common_area_name` y `community_name` NO estan en la tabla: es
 * el motivo de que estas lecturas sean funciones y no un `SELECT`.
 *
 * `total_count` solo viene en los dos listados, y es el total SIN paginar
 * (mismo criterio que I-12 en incidencias).
 */
export type ReservationRow = {
  id: string
  community_id: string
  community_name: string
  common_area_id: string
  common_area_name: string
  user_id: string
  user_name: string | null
  starts_at: Date
  ends_at: Date
  status: string
  attendees: number | null
  notes: string | null
  cancelled_at: Date | null
  created_at: Date
  updated_at: Date
}

/** Una fila de listado, que es `ReservationRow` mas el total. */
export type ReservationListRow = ReservationRow & { total_count: bigint }

/**
 * Listar las reservas de una comunidad.
 *
 * Toda la autorizacion esta dentro de la funcion: pertenencia (403 si no se es
 * miembro), filtros y REDACCION de `notes` (R-5). Aqui no hay ningun filtro de
 * rol ni ninguna logica de estado: un filtro en el codigo seria una segunda
 * implementacion del alcance que se puede desincronizar de la de SQL.
 *
 * `page` y `limit` se convierten en `offset` y `limit` aqui y no en el service.
 * La funcion acota el `limit` a 100 por si misma, asi que un `limit` enorme no
 * llega a ser un problema aunque se saltara el zod.
 *
 * Las columnas van LITERALES en la plantilla y no `select *`: escritas una a
 * una, un cambio en la funcion rompe el typecheck en vez de devolver las
 * columnas cruzadas en silencio.
 */
export async function listCommunityReservations(
  tx: Tx,
  communityId: string,
  filtros: {
    commonAreaId?: string
    date?: string
    status?: string
    limit: number
    offset: number
  },
): Promise<ReservationListRow[]> {
  return tx.$queryRaw<ReservationListRow[]>`
    select
      id, community_id, community_name, common_area_id, common_area_name,
      user_id, user_name, starts_at, ends_at, status, attendees, notes,
      cancelled_at, created_at, updated_at, total_count
      from app_list_community_reservations(
        ${communityId}::uuid,
        ${filtros.commonAreaId ?? null}::uuid,
        ${filtros.date ?? null}::date,
        ${filtros.status ?? null}::reservation_status,
        ${filtros.limit}::integer,
        ${filtros.offset}::integer
      )
  `
}

/**
 * `GET /reservations/me`: las reservas propias, en todas las comunidades.
 *
 * Sin comunidad en la funcion porque no la hay en la ruta, y porque el ambito
 * lo decide `user_id = app_current_user_id()` dentro. `notes` sale SIEMPRE sin
 * redactar: las filas son del llamante (R-5).
 */
export async function listUserReservations(
  tx: Tx,
  filtros: {
    status?: string
    limit: number
    offset: number
  },
): Promise<ReservationListRow[]> {
  return tx.$queryRaw<ReservationListRow[]>`
    select
      id, community_id, community_name, common_area_id, common_area_name,
      user_id, user_name, starts_at, ends_at, status, attendees, notes,
      cancelled_at, created_at, updated_at, total_count
      from app_list_user_reservations(
        ${filtros.status ?? null}::reservation_status,
        ${filtros.limit}::integer,
        ${filtros.offset}::integer
      )
  `
}

/**
 * Una reserva concreta, o null si no existe o no es visible.
 *
 * Que el 0 filas sea 404 lo decide el service, igual que en incidencias. La
 * funcion ya redacta `notes` (R-5), asi que un tercero que llegue aqui —no
 * deberia: `requireReservation()` ya ha puesto 404 solo si es visible— recibira
 * la fila con `notes` en null.
 */
export async function findReservation(tx: Tx, reservationId: string): Promise<ReservationRow | null> {
  const rows = await tx.$queryRaw<ReservationRow[]>`
    select
      id, community_id, community_name, common_area_id, common_area_name,
      user_id, user_name, starts_at, ends_at, status, attendees, notes,
      cancelled_at, created_at, updated_at
      from app_get_reservation(${reservationId}::uuid)
  `

  return rows[0] ?? null
}

/**
 * Crear una reserva y devolver su id.
 *
 * `$queryRaw` y no `$executeRaw` porque la funcion devuelve `uuid`.
 *
 * No hay parametro para `status`, `user_id` ni `community_id` (R-2): los tres
 * los decide la funcion dentro de la transaccion. Si el hueco esta ocupado, el
 * `23505` del indice unico sale de aqui y `errors.ts` lo traduce a un 409 —
 * es el caso de R-6, y este `select` es el unico sitio desde el que puede
 * pasar.
 */
export async function createReservation(
  tx: Tx,
  areaId: string,
  input: { startsAt: string; endsAt: string; attendees?: number; notes?: string | null },
): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    select app_create_reservation(
      ${areaId}::uuid,
      ${input.startsAt}::timestamptz,
      ${input.endsAt}::timestamptz,
      ${input.attendees ?? null}::integer,
      ${input.notes ?? null}
    ) as id
  `

  const row = rows[0]

  if (!row?.id) {
    throw new Error('app_create_reservation() no devolvió el id')
  }

  return row.id
}

/**
 * Confirmar una reserva (solo ADMIN, R-3).
 *
 * `$executeRaw` porque la funcion devuelve `void`: la respuesta se construye
 * releyendo con `findReservation()`, en la misma transaccion, para que diga el
 * estado real y no una suposicion.
 *
 * Si el hueco lo ha ocupado otra reserva entre la creacion y la confirmacion,
 * el `23505` sale de aqui con sentinel `reservation_slot_taken` y la reserva
 * sigue `PENDING`: no se auto-cancela, porque quien decide es quien estaba
 * confirmando.
 */
export async function confirm(tx: Tx, reservationId: string): Promise<void> {
  await tx.$executeRaw`select app_confirm_reservation(${reservationId}::uuid)`
}

/**
 * Cancelar una reserva (dueño o ADMIN, R-4).
 *
 * La funcion pone `status`, `cancelled_at` y borra los `area_slots` en la MISMA
 * transaccion. Este metodo no toca nada mas, y no por descuido: sin permiso de
 * `UPDATE` sobre `reservations` no hay otro camino, y un cancelado a medias
 * —estado puesto y slots vivos— dejaria la zona bloqueada para siempre.
 */
export async function cancel(tx: Tx, reservationId: string): Promise<void> {
  await tx.$executeRaw`select app_cancel_reservation(${reservationId}::uuid)`
}
