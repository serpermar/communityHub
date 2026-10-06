// ---------------------------------------------------------------------------
// Acceso a datos de zonas comunes.
//
// Es el unico sitio del modulo que escribe SQL. Todas las funciones reciben el
// cliente de transaccion, nunca el singleton: por construccion no se puede leer
// nada fuera del contexto de RLS.
//
// TODO de este archivo va por SQL a mano, y no es una mania:
//
//   - `app_runtime` no tiene INSERT ni UPDATE sobre `common_areas` (02f los
//     revoca), asi que el cliente de Prisma no puede escribir en la tabla.
//   - Las lecturas necesitan las `community_name` y `user_name` de las
//     funciones, que salen de `communities` y `users`, y las politicas de esas
//     tablas no dejan leer las ajenas.
//   - La disponibilidad es un calculo (rejilla en la timezone de la comunidad
//     contra `area_slots`) que no tiene sentido reimplementar en TypeScript:
//     seria una segunda verdad que podria discrepar del indice unico.
//
// Las columnas de `time` (`open_time`, `close_time`) se leen con `to_char` y no
// en crudo: el cliente de Prisma no tiene tipo `time` y las devuelve como
// `Date` con un fecha inventada, que es la forma de que la API devuelva
// "1970-01-01T08:00:00.000Z" en vez de "08:00". El `to_char` aqui es el que
// garantiza el contrato de la spec 05 7.1 (cadena `HH:MM`).
//
// Ninguna consulta lleva un valor del cliente dentro de un `Prisma.raw`: los
// nombres de columna van LITERALMENTE en la plantilla, porque en `$queryRaw`
// cualquier cosa metida en `${}` viaja como parametro ligado, no como SQL.
// ---------------------------------------------------------------------------

import { type Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

/**
 * Una fila de lectura de zona, tal como la devuelven las funciones de 02f.
 *
 * Los nombres van en `snake_case` porque son los de las columnas y los de los
 * `returns table`. El `service.ts` es quien los traduce a camelCase.
 *
 * `open_time` y `close_time` ya llegan como cadena `HH:MM` por el `to_char` de
 * la consulta, no como `Date`.
 */
export type CommonAreaRow = {
  id: string
  community_id: string
  name: string
  type: string
  description: string | null
  capacity: number | null
  slot_minutes: number
  open_time: string
  close_time: string
  max_daily_reservations: number | null
  requires_approval: boolean
  is_active: boolean
  created_by: string | null
  created_at: Date
  updated_at: Date
}

/** Una fila de la disponibilidad: un slot de la rejilla del dia. */
export type SlotRow = {
  slot_start: Date
  slot_end: Date
  status: string
}

/**
 * Listar las zonas de una comunidad.
 *
 * Toda la autorizacion esta dentro de la funcion: pertenencia (403 si no se es
 * miembro) y visibilidad de la zona. Aqui no hay ningun filtro de rol, y no por
 * descuido: leer zonas es de cualquier miembro activo (CA-1), y un filtro en
 * TypeScript seria una segunda implementacion de esa regla.
 *
 * Las columnas van LITERALES en la plantilla y no `select *`: escritas una a
 * una, un cambio en la funcion rompe el typecheck en vez de devolver las
 * columnas cruzadas en silencio.
 */
export async function listCommonAreas(tx: Tx, communityId: string): Promise<CommonAreaRow[]> {
  return tx.$queryRaw<CommonAreaRow[]>`
    select
      id, community_id, name, type, description,
      capacity, slot_minutes,
      to_char(open_time, 'HH24:MI') as open_time,
      to_char(close_time, 'HH24:MI') as close_time,
      max_daily_reservations, requires_approval, is_active,
      created_by, created_at, updated_at
      from app_list_common_areas(${communityId}::uuid)
  `
}

/**
 * Una zona concreta, o null si no existe o no es visible.
 *
 * Que el 0 filas sea 404 lo decide el service. La API no expone
 * `GET /common-areas/:id`, asi que esta funcion solo la usan el PUT (para
 * responder con la zona leida) y los tests.
 */
export async function findCommonArea(tx: Tx, areaId: string): Promise<CommonAreaRow | null> {
  const rows = await tx.$queryRaw<CommonAreaRow[]>`
    select
      id, community_id, name, type, description,
      capacity, slot_minutes,
      to_char(open_time, 'HH24:MI') as open_time,
      to_char(close_time, 'HH24:MI') as close_time,
      max_daily_reservations, requires_approval, is_active,
      created_by, created_at, updated_at
      from app_get_common_area(${areaId}::uuid)
  `

  return rows[0] ?? null
}

/**
 * Crear una zona y devolver su id.
 *
 * `$queryRaw` y no `$executeRaw` porque la funcion devuelve `uuid`. Los campos
 * ausentes del POST los decide la funcion con los mismos `coalesce` que los
 * defaults de la columna, para que "no lo mandaste" y "lo mandaste igual que el
 * default" acaben en el mismo sitio.
 *
 * El nombre duplicado NO se comprueba aqui con un SELECT previo: se deja pasar
 * y el `23505` del indice lo traduce `errors.ts` a un 409. Entre el SELECT y
 * el INSERT de dos altas simultaneas cabria una carrera, y el indice unico es
 * el que no la tiene.
 */
export async function createCommonArea(
  tx: Tx,
  communityId: string,
  input: {
    name: string
    type?: string
    description?: string | null
    capacity?: number | null
    slotMinutes?: number
    openTime?: string
    closeTime?: string
    maxDailyReservations?: number | null
    requiresApproval?: boolean
    isActive?: boolean
  },
): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    select app_create_common_area(
      ${communityId}::uuid,
      ${input.name},
      ${input.type ?? null}::common_area_type,
      ${input.description ?? null},
      ${input.capacity ?? null}::integer,
      ${input.slotMinutes ?? null}::integer,
      ${input.openTime ?? null}::time,
      ${input.closeTime ?? null}::time,
      ${input.maxDailyReservations ?? null}::integer,
      ${input.requiresApproval ?? null}::boolean,
      ${input.isActive ?? null}::boolean
    ) as id
  `

  const row = rows[0]

  if (!row?.id) {
    throw new Error('app_create_common_area() no devolvió el id')
  }

  return row.id
}

/**
 * Reconfigurar una zona (PUT, CA-4).
 *
 * `$executeRaw` porque la funcion devuelve `setof common_areas` y la fila se
 * relee despues con `findCommonArea()`, dentro de la misma transaccion: la
 * respuesta sale de una lectura y no de los parametros de entrada, que es lo
 * unico que garantiza que lo que devuelve la API es lo que quedo escrito.
 *
 * `p_community_id` no existe como parametro: la comunidad la decide la propia
 * fila, y la funcion no dejaria escribir una zona de otra comunidad aunque se
 * la pasara.
 */
export async function updateCommonArea(
  tx: Tx,
  areaId: string,
  input: {
    name: string
    type: string
    description: string | null
    capacity: number | null
    slotMinutes: number
    openTime: string
    closeTime: string
    maxDailyReservations: number | null
    requiresApproval: boolean
    isActive: boolean
  },
): Promise<void> {
  await tx.$executeRaw`
    select app_update_common_area(
      ${areaId}::uuid,
      ${input.name},
      ${input.type}::common_area_type,
      ${input.description},
      ${input.capacity}::integer,
      ${input.slotMinutes}::integer,
      ${input.openTime}::time,
      ${input.closeTime}::time,
      ${input.maxDailyReservations}::integer,
      ${input.requiresApproval}::boolean,
      ${input.isActive}::boolean
    )
  `
}

/**
 * La rejilla de un dia concreto.
 *
 * El calculo (timezone de la comunidad, `slot_minutes`, ocupacion por
 * `area_slots`) vive entero en `app_get_area_availability()`. Aqui solo se
 * piden las columnas: reimplementar la rejilla en TypeScript seria una segunda
 * verdad que podria discrepar del indice unico, que es exactamente el fallo que
 * CA-7 y D-2 estan evitando.
 */
export async function getAvailability(tx: Tx, areaId: string, date: string): Promise<SlotRow[]> {
  return tx.$queryRaw<SlotRow[]>`
    select slot_start, slot_end, status
      from app_get_area_availability(${areaId}::uuid, ${date}::date)
  `
}
