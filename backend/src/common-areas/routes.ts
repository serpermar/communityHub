// ---------------------------------------------------------------------------
// Rutas de zonas comunes.
//
// Se montan en DOS routers porque las cuatro rutas no comparten el mismo
// prefijo: las dos de comunidad cuelgan de `/api/v1/communities` y las otras
// dos de `/api/v1`. Los montajes en `app.ts` son dos `app.use` distintos, y el
// orden no importa porque cada router solo atiende las suyas.
//
// Y las rutas se escriben COMPLETAS dentro de cada router, en vez de montar un
// router en un camino con parametros, que es lo que ya hacen los bloques 01-04:
// deja claro que las rutas de comunidad cuelgan del mismo sitio que las de
// `/communities/:communityId`.
//
// El orden de los middleware ES la autorizacion:
//
//   GET  /communities/:communityId/common-areas   requireAuth + requireCommunity()
//   POST /communities/:communityId/common-areas   + requireCommunityRole('ADMIN')
//   PUT  /common-areas/:id                        requireAuth + requireCommonArea()
//   GET  /common-areas/:id/availability           requireAuth + requireCommonArea()
//
// TRES cosas que se ven aqui y que son decisiones, no descuido:
//
//   1. `requireCommonArea()` va DESPUES de `requireAuth`, siempre. Necesita
//      `req.auth`. Al reves, el 401 seria un TypeError.
//
//   2. `requireCommonArea()` NO lleva `requireCommunityRole`. El rol lo
//      consulta `app_role_in()` dentro de `app_common_area_community`, contra
//      la fila, y quien decide que se puede hacer con ese rol son
//      `app_create_common_area()` y `app_update_common_area()`, dentro de la
//      transaccion.
//
//   3. El POST si lleva `requireCommunityRole('ADMIN')` como chequeo grueso,
//      igual que el POST de incidencias. La funcion lo repite dentro.
// ---------------------------------------------------------------------------

import { Router } from 'express'
import * as controller from './controller.js'
import { requireAuth, requireCommunity, requireCommunityRole } from '../auth/middleware.js'
import { requireCommonArea } from './middleware.js'

/**
 * Rutas con la comunidad en la URL.
 *
 * El listado NO lleva `requireCommunityRole`: CA-1 dice que lee cualquier
 * miembro activo, y el alcance lo decide `app_list_common_areas()`.
 *
 * El alta si lo lleva, y solo `ADMIN`: "Gestionar zonas comunes" es de ADMIN
 * unico en la matriz de ARCHITECTURE.md §5.
 */
export function createCommonAreasRouter(): Router {
  const router = Router()

  /**
   * @swagger
   * /api/v1/communities/{communityId}/common-areas:
   *   get:
   *     summary: Listar zonas comunes de una comunidad
   *     tags: [CommonAreas]
   *     parameters:
   *       - in: path
   *         name: communityId
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200:
   *         description: Lista de zonas.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/CommonAreaListResponse' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   */
  router.get(
    '/:communityId/common-areas',
    requireAuth,
    requireCommunity(),
    controller.listCommonAreas,
  )

  /**
   * @swagger
   * /api/v1/communities/{communityId}/common-areas:
   *   post:
   *     summary: Crear una zona común
   *     description: Requiere rol ADMIN.
   *     tags: [CommonAreas]
   *     parameters:
   *       - in: path
   *         name: communityId
   *         required: true
   *         schema: { type: string, format: uuid }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [name, type]
   *             properties:
   *               name: { type: string, minLength: 1, maxLength: 120 }
   *               type: { $ref: '#/components/schemas/CommonAreaType' }
   *               description: { type: string, nullable: true }
   *               capacity: { type: integer, minimum: 1, nullable: true }
   *               slotMinutes: { type: integer, minimum: 15, default: 60 }
   *               openTime: { type: string, example: '08:00' }
   *               closeTime: { type: string, example: '22:00' }
   *               maxDailyReservations: { type: integer, minimum: 1, nullable: true }
   *               requiresApproval: { type: boolean, default: false }
   *     responses:
   *       201:
   *         description: Zona creada.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/CommonArea' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   */
  router.post(
    '/:communityId/common-areas',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('ADMIN'),
    controller.createCommonArea,
  )

  return router
}

/**
 * Rutas con la zona en la URL.
 *
 * `requireCommonArea()` sustituye a `requireCommunity()` en las dos: resuelve
 * la comunidad de la zona y la deja en `req.community`.
 *
 * Ninguna de las dos lleva `requireCommunityRole('ADMIN')`, ni siquiera el PUT:
 * el rol lo decide `app_update_common_area()` con la fila delante, por el
 * argumento 2 de la cabecera.
 */
export function createCommonAreaRouter(): Router {
  const router = Router()

  /**
   * @swagger
   * /api/v1/common-areas/{id}:
   *   put:
   *     summary: Actualizar una zona común
   *     description: |
   *       Requiere rol ADMIN. El rol se comprueba en `app_update_common_area()`
   *       con la fila delante.
   *     tags: [CommonAreas]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name: { type: string, minLength: 1, maxLength: 120 }
   *               type: { $ref: '#/components/schemas/CommonAreaType' }
   *               description: { type: string, nullable: true }
   *               capacity: { type: integer, nullable: true }
   *               slotMinutes: { type: integer, minimum: 15 }
   *               openTime: { type: string, example: '08:00' }
   *               closeTime: { type: string, example: '22:00' }
   *               maxDailyReservations: { type: integer, nullable: true }
   *               requiresApproval: { type: boolean }
   *               isActive: { type: boolean }
   *     responses:
   *       200:
   *         description: Zona actualizada.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/CommonArea' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.put('/common-areas/:id', requireAuth, requireCommonArea(), controller.updateCommonArea)

  /**
   * @swagger
   * /api/v1/common-areas/{id}/availability:
   *   get:
   *     summary: Disponibilidad de una zona común
   *     description: Devuelve los huecos reservables de la zona en un día concreto.
   *     tags: [CommonAreas]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *       - in: query
   *         name: date
   *         required: true
   *         schema: { type: string, format: date }
   *         description: Día del que se quiere la disponibilidad, en formato YYYY-MM-DD.
   *         example: '2026-11-10'
   *     responses:
   *       200:
   *         description: Huecos disponibles.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/CommonAreaAvailability' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.get(
    '/common-areas/:id/availability',
    requireAuth,
    requireCommonArea(),
    controller.getAvailability,
  )

  return router
}
