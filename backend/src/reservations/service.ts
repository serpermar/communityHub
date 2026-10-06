// ---------------------------------------------------------------------------
// Servicio de reservas.
//
// Aqui vive la logica de negocio. Los controllers solo reparten peticiones y
// los repositorios solo ejecutan SQL.
//
// La autorizacion esta en dos capas y las dos se necesitan, igual que en los
// bloques 03 y 04. `requireReservation()` comprueba la visibilidad CONTRA ESTADO
// en las rutas sin comunidad en la URL, y las funciones de SQL comprueban el
// rol DENTRO de la transaccion, en el unico sitio donde el motor lo ve.
//
// Y ninguna regla se decide leyendo filas y comparando en TypeScript: el solape
// de slots (R-6), el estado inicial (R-2), la confirmacion (R-3) y la
// cancelacion con borrado de slots (R-4) son cosas que tienen que pasar en la
// MISMA transaccion que la escritura, o entre una y otra se cuela otra peticion
// concurrente.
//
// Ninguna funcion de este archivo filtra por rol ni por estado: seria una segunda
// implementacion del alcance de SQL.
// ---------------------------------------------------------------------------

import { withContext } from '../context.js'
import { notFound } from '../http/errors.js'
import type { CreateReservationInput, ListQueryInput, MeQueryInput } from './validators.js'
import * as repo from './repository.js'
import { ejecuta } from './errors.js'

/**
 * La reserva tal como sale en la API (spec 06 §7.1).
 *
 * `notes` puede venir `null` por dos motivos distintos y la API no los
 * distingue a proposito: porque no se dijo nada, o porque no es tuya (R-5).
 * Distinguirlos solo beneficiaria a un atacante que quisiera saber si hay texto
 * oculto.
 */
export type ReservationView = {
  id: string
  communityId: string
  communityName: string
  commonAreaId: string
  commonAreaName: string
  userId: string
  userName: string | null
  startsAt: string
  endsAt: string
  status: string
  attendees: number | null
  notes: string | null
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
}

/** La lista con su paginacion en `meta`. */
export type ReservationListView = {
  items: ReservationView[]
  meta: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

function toReservationView(row: repo.ReservationRow): ReservationView {
  return {
    id: row.id,
    communityId: row.community_id,
    communityName: row.community_name,
    commonAreaId: row.common_area_id,
    commonAreaName: row.common_area_name,
    userId: row.user_id,
    userName: row.user_name,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    status: row.status,
    attendees: row.attendees,
    notes: row.notes,
    cancelledAt: row.cancelled_at ? row.cancelled_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

/**
 * Traduce el total de Postgres al `meta.total` de la API.
 *
 * `total_count` viene como `bigint`, y en el cliente JSON de `pg` un `bigint`
 * llega como string, no como numero: sin esta conversion, `meta.total` seria
 * `"7"` y el frontend tendria que compararlo como texto.
 */
function toTotal(total: bigint): number {
  return Number(total)
}

/**
 * Monta la respuesta paginada a partir de las filas del listado.
 *
 * Es el mismo apano que en incidencias, por el mismo motivo: la funcion trae el
 * total con `count(*) over ()`, pero una ventana se evalua sobre las filas que
 * SALEN, y si la pagina esta mas alla del final no sale ninguna fila que lleve
 * el total. Sin el apano, la pagina 5 de 3 diria `total: 0, totalPages: 0`.
 *
 * El apano es una segunda llamada a la MISMA funcion con `offset 0` y `limit 1`,
 * que si devuelve una fila y con ella el total real. Se hace solo cuando la
 * pagina salio vacia y no era la primera, y por la misma razon que no se hace un
 * `count` aparte siempre: dos consultas pueden ver distinto, y aqui las dos van
 * en la misma transaccion con los mismos filtros.
 *
 * `totalPages` es un entero hacia arriba, y da 0 cuando no hay nada: un `ceil`
 * a 0 diria "pagina 1 de 0", que no le sirve a nadie.
 */
function paginar(
  rows: repo.ReservationListRow[],
  page: number,
  limit: number,
): ReservationListView {
  let total = 0
  const primera = rows[0]

  if (primera) {
    total = toTotal(primera.total_count)
  }

  return {
    items: rows.map(toReservationView),
    meta: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  }
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/**
 * Listar las reservas de una comunidad.
 *
 * `requireCommunity()` de la ruta comprueba pertenencia, y la funcion repite el
 * check dentro. El alcance de lo que sale lo decide ella: cualquier miembro ve
 * todas las reservas de su comunidad (R-5), con `notes` redactado salvo que sea
 * suyo, ADMIN o PRESIDENT.
 *
 * El filtro `date` es por dia LOCAL de la comunidad y no por dia UTC: a las
 * 23:00 de Valencia ya es otro dia en UTC, y la agenda es local (R-10).
 */
export async function listReservations(
  userId: string,
  communityId: string,
  query: ListQueryInput,
): Promise<ReservationListView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const page = query.page ?? 1
      const limit = query.limit ?? 20
      const offset = (page - 1) * limit

      const filtros = {
        commonAreaId: query.commonAreaId,
        date: query.date,
        status: query.status,
      }

      const rows = await repo.listCommunityReservations(tx, communityId, { ...filtros, limit, offset })

      if (rows.length === 0 && offset > 0) {
        const muestra = await repo.listCommunityReservations(tx, communityId, { ...filtros, limit: 1, offset: 0 })
        if (muestra.length === 0) {
          return { items: [], meta: { page, limit, total: 0, totalPages: 0 } }
        }
        const view = paginar(muestra, page, limit)
        return { items: [], meta: view.meta }
      }

      return paginar(rows, page, limit)
    }),
  )
}

/**
 * `GET /reservations/me`: la agenda propia en todas las comunidades (R-5).
 *
 * No hay `communityId` aqui ni puede haberlo: el ambito lo pone la funcion con
 * `user_id = app_current_user_id()`, y `notes` sale siempre sin redactar porque
 * las filas son del llamante.
 */
export async function listMyReservations(userId: string, query: MeQueryInput): Promise<ReservationListView> {
  return ejecuta(() =>
    withContext({ userId, communityId: null }, async (tx) => {
      const page = query.page ?? 1
      const limit = query.limit ?? 20
      const offset = (page - 1) * limit

      const rows = await repo.listUserReservations(tx, { status: query.status, limit, offset })

      if (rows.length === 0 && offset > 0) {
        const muestra = await repo.listUserReservations(tx, { status: query.status, limit: 1, offset: 0 })
        if (muestra.length === 0) {
          return { items: [], meta: { page, limit, total: 0, totalPages: 0 } }
        }
        const view = paginar(muestra, page, limit)
        return { items: [], meta: view.meta }
      }

      return paginar(rows, page, limit)
    }),
  )
}

/**
 * Una reserva concreta.
 *
 * El `requireReservation()` de la ruta ya ha resuelto la comunidad y ha puesto
 * 404 si no es visible, asi que llegar aqui casi siempre significa que existe.
 * El 404 de este `if` es la segunda red: la funcion vuelve a filtrar por
 * visibilidad, y si entre el guard y esta llamada la reserva desapareciera
 * (fisicamente no puede: no hay DELETE, pero si un cambio de membresia), aqui
 * sale el 404 correcto en vez de un objeto a medias.
 */
export async function getReservation(userId: string, communityId: string, reservationId: string): Promise<ReservationView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const row = await repo.findReservation(tx, reservationId)

      if (!row) {
        throw notFound('Esa reserva no existe.')
      }

      return toReservationView(row)
    }),
  )
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

/**
 * Crear una reserva.
 *
 * El rol lo comprueba el guard de la ruta (`NEIGHBOR`, `PRESIDENT`, `ADMIN`,
 * R-1) y la funcion lo repite dentro de la transaccion: si el guard se olvidara,
 * el endpoint seguiria siendo seguro. Aqui no se decide nada de eso.
 *
 * Todo lo demas lo decide `app_create_reservation()` DENTRO de la transaccion,
 * y tiene que ser ahi: la zona activa, la rejilla, el horario, la capacidad, el
 * limite diario y —lo importante— la insercion de los slots contra el indice
 * unico del solape. Dos peticiones simultaneas al mismo hueco pasarian
 * cualquier comprobacion hecha en TypeScript, porque entre leer y escribir
 * caberia la otra.
 *
 * El `status` no se calcula aqui: nace de `requires_approval` de la zona (R-2),
 * y calcularlo en dos sitios es la forma de que un dia discrepen.
 *
 * Se relee la reserva creada con `app_get_reservation()` y se devuelve esa, en
 * vez de inventar la respuesta: la funcion devuelve solo el id justamente para
 * no poder devolver medio estado.
 */
export async function createReservation(
  userId: string,
  communityId: string,
  areaId: string,
  input: CreateReservationInput,
): Promise<ReservationView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const id = await repo.createReservation(tx, areaId, input)

      const row = await repo.findReservation(tx, id)

      if (!row) {
        // La funcion es SECURITY DEFINER y acaba de insertar la fila; si no se
        // ve, algo se ha roto por debajo. Un 404 seria mentira: si que existe.
        throw new Error('La reserva se creó pero no se puede leer.')
      }

      return toReservationView(row)
    }),
  )
}

/**
 * Confirmar una reserva (solo ADMIN, R-3, D-2).
 *
 * Ninguna comprobacion aqui. El rol, el estado `PENDING` y la insercion de los
 * slots son de `app_confirm_reservation()`, dentro de la transaccion, con la
 * fila delante. En concreto, el `409` de un hueco ya ocupado solo puede salir
 * de ahi: comprobarlo antes en TypeScript seria un check-then-insert que deja
 * una ventana entre las dos, que es exactamente el fallo que R-6 existe para
 * evitar.
 */
export async function confirmReservation(
  userId: string,
  communityId: string,
  reservationId: string,
): Promise<ReservationView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      await repo.confirm(tx, reservationId)

      const row = await repo.findReservation(tx, reservationId)

      if (!row) {
        throw notFound('Esa reserva no existe.')
      }

      return toReservationView(row)
    }),
  )
}

/**
 * Cancelar una reserva (dueño o ADMIN, R-4, D-3).
 *
 * Tres cambios atómicos dentro de `app_cancel_reservation()`: `status`,
 * `cancelled_at` y el borrado de sus `area_slots`. El tercer paso es el que
 * hace que este metodo no pueda ser un `update` de Prisma: sin el, la piscina
 * quedaria bloqueada por una reserva que la app dice cancelada, y ni el ADMIN
 * ni el dueño podrian reservar ese hueco.
 *
 * El rol (dueño o ADMIN, nunca PRESIDENT) lo decide la funcion contra la fila.
 */
export async function cancelReservation(
  userId: string,
  communityId: string,
  reservationId: string,
): Promise<ReservationView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      await repo.cancel(tx, reservationId)

      const row = await repo.findReservation(tx, reservationId)

      if (!row) {
        throw notFound('Esa reserva no existe.')
      }

      return toReservationView(row)
    }),
  )
}
