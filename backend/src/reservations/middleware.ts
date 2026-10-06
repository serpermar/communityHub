// ---------------------------------------------------------------------------
// Middleware de reservas.
//
// Una sola pieza, `requireReservation()`, y existe por la misma razon que
// `requireIncident()`: TRES de las seis rutas de reserva NO llevan
// `communityId` en la URL:
//
//   GET   /api/v1/reservations/:id
//   PATCH /api/v1/reservations/:id/cancel
//   POST  /api/v1/reservations/:id/confirm
//
// Eso es lo que dice ARCHITECTURE.md §6, y tiene sentido: una reserva tiene ya
// su comunidad, y pedirla a la vez seria pedir dos veces lo mismo. El precio es
// que `requireCommunity()` no se puede usar, y este middleware es el
// equivalente: resuelve la comunidad de la reserva con
// `app_reservation_community()` y la deja en `req.community`.
//
// Por que NO lleva `requireCommunityRole`: el rol no se decide aqui. Lo
// consulta `app_role_in()` dentro de la misma funcion, contra la fila, y quien
// decide que se puede hacer con ese rol son `app_confirm_reservation()` (solo
// ADMIN) y `app_cancel_reservation()` (dueño o ADMIN), dentro de la
// transaccion. Un guard `requireCommunityRole('ADMIN')` en el confirm daria el
// mismo 403 con un mensaje peor, y si el guard se olvidara el endpoint
// seguiria seguro —pero al reves, si la comprobacion viviera solo en el guard,
// el mismo endpoint seria un agujero por PostgREST.
//
// `GET /reservations/me` NO pasa por aqui: no hay recurso que resolver, y el
// ambito lo pone la propia funcion (`user_id = app_current_user_id()`).
//
// Por que va en ESTE archivo y no en `auth/middleware.ts`: ese es del bloque 01
// y la spec 03 declaro que no se toca. La convencion del proyecto es validar en
// el modulo.
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express'
import { withContext } from '../context.js'
import { badRequest, forbidden, notFound, unauthorized } from '../http/errors.js'
import { routeParam } from '../auth/middleware.js'

/** Mismo criterio que `requireUuidParam` de `auth/middleware.ts` (C-9). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `app_reservation_community()` devuelve la comunidad de la reserva, o NULL si
 * el actor no puede verla.
 */
async function comunidadDe(reservationId: string, userId: string): Promise<string | null> {
  return withContext({ userId, communityId: null }, async (tx) => {
    const rows = await tx.$queryRaw<Array<{ community_id: string | null }>>`
      select app_reservation_community(${reservationId}::uuid) as community_id
    `
    return rows[0]?.community_id ?? null
  })
}

/**
 * Exige una reserva visible y deja su comunidad en `req.community`.
 *
 * Tres casos y tres respuestas, y la diferencia importa:
 *
 *   - `:id` que no es un UUID: **400**. Peticion mal formada. Comprobado antes
 *     de tocar la base de datos, porque un `::uuid` sobre texto invalido
 *     revienta con 22P02.
 *   - `:id` que no existe, o que existe pero no es visible para este actor:
 *     **404**. Los dos son el mismo 404 y por el mismo motivo (C-8): un 403
 *     confirmaria que ese id existe. La visibilidad aqui es la de R-5 (cualquier
 *     miembro activo de la comunidad), no la de "es tuya": un vecino que llega
 *     al detalle de la reserva de otro recibe el detalle, con `notes` en null.
 *   - `:id` de una comunidad a la que ya no pertenece: tambien **404**, no 403.
 *     Mismo argumento.
 *
 * El `communityId: null` del `withContext` no es un descuido: la comunidad la
 * DECIDE la consulta, no el contexto.
 */
export function requireReservation(paramName = 'id') {
  return async function reservationGuard(req: Request, _res: Response, next: NextFunction): Promise<void> {
    if (!req.auth) {
      throw unauthorized()
    }

    const reservationId = routeParam(req, paramName)

    if (!UUID_RE.test(reservationId)) {
      throw badRequest(`El parámetro ${paramName} debe ser un UUID.`)
    }

    const communityId = await comunidadDe(reservationId, req.auth.userId)

    if (!communityId) {
      throw notFound('Esa reserva no existe.')
    }

    // El rol se resuelve aqui con `app_role_in()` y no con el del token de
    // sesion, por el mismo motivo que en `requireCommunity`: el token dura 15
    // minutos, y leer el rol de ahi permitiria seguir siendo ADMIN durante la
    // ventana despues de haber sido degradado. Aqui no se usa para autorizar
    // nada —eso lo hacen las funciones— pero deja `req.community` completo para
    // que el servicio funcione como en el resto del proyecto.
    const rows = await withContext({ userId: req.auth.userId, communityId }, (tx) =>
      tx.$queryRaw<Array<{ role: string | null }>>`
        select app_role_in(${communityId}::uuid) as role
      `,
    )

    const role = rows[0]?.role ?? null

    // No deberia pasar: si `app_reservation_community()` dice que se ve, hay
    // membresia activa. Si pasara, es un bug en el predicado, y un 403 es la
    // respuesta honesta.
    if (!role) {
      throw forbidden('No perteneces a esta comunidad.')
    }

    req.community = { communityId, role }
    next()
  }
}
