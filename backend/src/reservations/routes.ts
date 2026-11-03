// ---------------------------------------------------------------------------
// Rutas de reservas.
//
// Se montan en DOS routers porque las seis rutas no comparten el mismo prefijo:
// la de comunidad cuelga de `/api/v1/communities` y las otras cinco de
// `/api/v1`. Los montajes en `app.ts` son dos `app.use` distintos, y el orden
// no importa porque cada router solo atiende las suyas.
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
//      `requireAuth`, siempre.
//
//   2. `requireReservation()` NO lleva `requireCommunityRole`. El rol lo
//      consulta `app_role_in()` dentro de `app_reservation_community`, contra
//      la fila, y quien decide que se puede hacer con ese rol son
//      `app_confirm_reservation()` (solo ADMIN) y `app_cancel_reservation()`
//      (dueño o ADMIN), dentro de la transaccion.
//
//   3. El `GET /reservations/me` no lleva guard de comunidad ni de reserva:
//      no hay recurso que resolver. El ambito lo pone la funcion con
//      `user_id = app_current_user_id()`.
//
//   4. El POST de alta si lleva `requireCommunityRole('NEIGHBOR', 'PRESIDENT',
//      'ADMIN')` como guard grueso. En cambio, el `POST /:id/confirm` NO lleva
//      `requireCommunityRole('ADMIN')`, aunque solo el ADMIN pueda confirmar.
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

  /**
   * @swagger
   * /api/v1/communities/{communityId}/reservations:
   *   get:
   *     summary: Listar reservas de una comunidad
   *     description: |
   *       Cualquier miembro activo puede listar. La redacción de `notes` y el
   *       alcance los decide `app_list_community_reservations()`.
   *     tags: [Reservations]
   *     parameters:
   *       - in: path
   *         name: communityId
   *         required: true
   *         schema: { type: string, format: uuid }
   *       - in: query
   *         name: page
   *         schema: { type: integer, minimum: 1, default: 1 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
   *     responses:
   *       200:
   *         description: Lista paginada de reservas.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/ReservationListResponse' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   */
  router.get(
    '/:communityId/reservations',
    requireAuth,
    requireCommunity(),
    controller.listReservations,
  )

  return router
}

/**
 * Rutas con la reserva o la zona en la URL.
 *
 * `requireCommonArea()` en la alta resuelve la comunidad de la ZONA. Y
 * `requireReservation()` en las otras tres resuelve la comunidad de la
 * RESERVA. Los dos son la misma idea (traer la comunidad de la fila a
 * `req.community`) aplicada a dos filas distintas.
 */
export function createReservationRouter(): Router {
  const router = Router()

  /**
   * @swagger
   * /api/v1/common-areas/{id}/reservations:
   *   post:
   *     summary: Crear una reserva de una zona común
   *     description: |
   *       `requireCommonArea()` resuelve la comunidad de la zona. Requiere rol
   *       NEIGHBOR, PRESIDENT o ADMIN: un PROVIDER trabaja en la comunidad, no
   *       la usa (R-1).
   *     tags: [Reservations]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *         description: ID de la zona común.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [startsAt, endsAt]
   *             properties:
   *               startsAt: { type: string, format: date-time }
   *               endsAt: { type: string, format: date-time }
   *               attendees: { type: integer, minimum: 1, nullable: true }
   *               notes: { type: string, nullable: true }
   *     responses:
   *       201:
   *         description: Reserva creada.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Reservation' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       409: { $ref: '#/components/responses/Conflict' }
   */
  router.post(
    '/common-areas/:id/reservations',
    requireAuth,
    requireCommonArea(),
    requireCommunityRole('NEIGHBOR', 'PRESIDENT', 'ADMIN'),
    controller.createReservation,
  )

  /**
   * @swagger
   * /api/v1/reservations/me:
   *   get:
   *     summary: Listar mis reservas
   *     description: |
   *       Devuelve las reservas del usuario autenticado, en cualquier
   *       comunidad. El ámbito lo fija `user_id = app_current_user_id()`.
   *     tags: [Reservations]
   *     responses:
   *       200:
   *         description: Reservas del usuario.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/ReservationListResponse' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   */
  router.get('/reservations/me', requireAuth, controller.listMyReservations)

  /**
   * @swagger
   * /api/v1/reservations/{id}:
   *   get:
   *     summary: Detalle de una reserva
   *     tags: [Reservations]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200:
   *         description: Reserva.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Reservation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.get('/reservations/:id', requireAuth, requireReservation(), controller.getReservation)

  /**
   * @swagger
   * /api/v1/reservations/{id}/cancel:
   *   patch:
   *     summary: Cancelar una reserva
   *     description: |
   *       Puede cancelar el dueño de la reserva o un ADMIN. El 403 lo emite
   *       `app_cancel_reservation()` con la fila delante.
   *     tags: [Reservations]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200:
   *         description: Reserva cancelada.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Reservation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       404: { $ref: '#/components/responses/NotFound' }
   *       409: { $ref: '#/components/responses/Conflict' }
   */
  router.patch(
    '/reservations/:id/cancel',
    requireAuth,
    requireReservation(),
    controller.cancelReservation,
  )

  /**
   * @swagger
   * /api/v1/reservations/{id}/confirm:
   *   post:
   *     summary: Confirmar una reserva
   *     description: Requiere rol ADMIN. El 403 lo emite `app_confirm_reservation()`.
   *     tags: [Reservations]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200:
   *         description: Reserva confirmada.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Reservation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       404: { $ref: '#/components/responses/NotFound' }
   *       409: { $ref: '#/components/responses/Conflict' }
   */
  router.post(
    '/reservations/:id/confirm',
    requireAuth,
    requireReservation(),
    controller.confirmReservation,
  )

  return router
}
