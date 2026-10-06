// ---------------------------------------------------------------------------
// Rutas de reservas.
//
// Se montan en DOS routers porque las seis rutas no comparten el mismo prefijo:
// la de comunidad cuelga de `/api/v1/communities` y las otras cinco de
// `/api/v1`. Los montajes en `app.ts` son dos `app.use` distintos, y el orden
// no importa porque cada router solo atiende las suyas.
//
// Y las rutas se escriben COMPLETAS dentro de cada router, en vez de montar un
// router en un camino con parametros, que es lo que ya hacen los bloques 01-04:
// deja claro que la ruta de comunidad cuelga del mismo sitio que la de
// `/communities/:communityId/incidents`.
//
// El orden de los middleware ES la autorizacion:
//
//   GET   /communities/:communityId/reservations   requireAuth + requireCommunity()
//   GET   /reservations/me                         requireAuth
//   POST  /common-areas/:id/reservations           requireAuth + requireCommonArea() + requireCommunityRole(NEIGHBOR, PRESIDENT, ADMIN)
//   GET   /reservations/:id                        requireAuth + requireReservation()
//   PATCH /reservations/:id/cancel                 requireAuth + requireReservation()
//   POST  /reservations/:id/confirm                requireAuth + requireReservation()
//
// CUATRO cosas que se ven aqui y que son decisiones, no descuido:
//
//   1. `requireReservation()` y `requireCommonArea()` van DESPUES de
//      `requireAuth`, siempre. Necesitan `req.auth`. Al reves, el 401 seria un
//      TypeError.
//
//   2. `requireReservation()` NO lleva `requireCommunityRole`. El rol lo
//      consulta `app_role_in()` dentro de `app_reservation_community`, contra
//      la fila, y quien decide que se puede hacer con ese rol son
//      `app_confirm_reservation()` (solo ADMIN) y `app_cancel_reservation()`
//      (dueño o ADMIN), dentro de la transaccion. Un guard `requireCommunityRole`
//      aqui daria el mismo 403 con un mensaje peor, y si el guard se olvidara
//      el endpoint seguiria seguro —pero al reves, si la comprobacion viviera
//      solo en el guard, el mismo endpoint seria un agujero por PostgREST, que
//      no pasa por Express.
//
//   3. El `GET /reservations/me` no lleva guard de comunidad ni de reserva: no
//      hay recurso que resolver. El ambito lo pone la funcion con
//      `user_id = app_current_user_id()`, y es lo unico que impide que me
//      pidan las reservas de otro —que la funcion devuelve vacias, no 403,
//      porque decir "existe y no es tuya" tambien es filtrar.
//
//   4. El POST de alta si lleva `requireCommunityRole('NEIGHBOR', 'PRESIDENT',
//      'ADMIN')` como guard grueso. Reservar es cosa de quien vive en la
//      comunidad: los PROVIDER trabajan en ella, no la usan (R-1). El rol lo
//      repite `app_create_reservation()` dentro de la transaccion, por el
//      argumento 2 de la cabecera. En cambio, el `POST /:id/confirm` NO lleva
//      `requireCommunityRole('ADMIN')`, aunque solo el ADMIN pueda confirmar:
//      el 403 tiene que salir de la funcion, con la fila delante.
// ---------------------------------------------------------------------------

import { Router } from 'express'
import * as controller from './controller.js'
import { requireAuth, requireCommunity, requireCommunityRole } from '../auth/middleware.js'
import { requireCommonArea } from '../common-areas/middleware.js'
import { requireReservation } from './middleware.js'

/**
 * Rutas con la comunidad en la URL.
 *
 * El listado NO lleva `requireCommunityRole`: R-5 dice que lee cualquier
 * miembro activo, y el alcance (y la redaccion de `notes`) lo decide
 * `app_list_community_reservations()`.
 */
export function createReservationsRouter(): Router {
  const router = Router()

  router.get('/:communityId/reservations', requireAuth, requireCommunity(), controller.listReservations)

  return router
}

/**
 * Rutas con la reserva o la zona en la URL.
 *
 * `requireCommonArea()` en la alta resuelve la comunidad de la ZONA —misma
 * funcion que en el bloque 05, reutilizada de ahi: no hay una segunda version
 * del guard— y deja `req.community` listo para el guard de rol.
 *
 * `requireReservation()` en las otras tres resuelve la comunidad de la
 * RESERVA. Los dos son la misma idea (traer la comunidad de la fila a
 * `req.community`) aplicada a dos filas distintas.
 */
export function createReservationRouter(): Router {
  const router = Router()

  router.post(
    '/common-areas/:id/reservations',
    requireAuth,
    requireCommonArea(),
    requireCommunityRole('NEIGHBOR', 'PRESIDENT', 'ADMIN'),
    controller.createReservation,
  )

  router.get('/reservations/me', requireAuth, controller.listMyReservations)
  router.get('/reservations/:id', requireAuth, requireReservation(), controller.getReservation)
  router.patch('/reservations/:id/cancel', requireAuth, requireReservation(), controller.cancelReservation)
  router.post('/reservations/:id/confirm', requireAuth, requireReservation(), controller.confirmReservation)

  return router
}
