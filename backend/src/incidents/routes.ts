// ---------------------------------------------------------------------------
// Rutas de incidencias.
//
// Se montan en DOS routers porque las ocho rutas no comparten el mismo prefijo:
// las dos de comunidad cuelgan de `/api/v1/communities` y las otras seis de
// `/api/v1`. Los montajes en `app.ts` son dos `app.use` distintos, y el orden no
// importa porque cada router solo atiende las suyas.
//
// El orden de los middleware ES la autorizacion:
//
//   GET    /communities/:communityId/incidents   requireAuth + requireCommunity()
//   POST   /communities/:communityId/incidents   + requireCommunityRole(NEIGHBOR, PRESIDENT, ADMIN)
//   GET    /incidents/:id                        requireAuth + requireIncident()
//   PUT    /incidents/:id                        requireAuth + requireIncident()
//   PATCH  /incidents/:id/status                 requireAuth + requireIncident()
//   DELETE /incidents/:id                        requireAuth + requireIncident()
//   GET    /incidents/:id/comments               requireAuth + requireIncident()
//   POST   /incidents/:id/comments               requireAuth + requireIncident()
//
// TRES cosas que se ven aqui y que son decisiones, no descuido:
//
//   1. `requireIncident()` va DESPUES de `requireAuth`, siempre.
//
//   2. `requireIncident()` NO lleva `requireCommunityRole`. El rol lo consulta
//      `app_role_in()` dentro de `app_incident_community`, contra la fila.
//
//   3. El POST lleva `requireCommunityRole('NEIGHBOR', 'PRESIDENT', 'ADMIN')`
//      y NO `requireCommunityRole('PROVIDER')`.
// ---------------------------------------------------------------------------

import { Router } from 'express'
import * as controller from './controller.js'
import { requireAuth, requireCommunity, requireCommunityRole } from '../auth/middleware.js'
import { requireIncident } from './middleware.js'

export function createIncidentsRouter(): Router {
  const router = Router()

  /**
   * @swagger
   * /api/v1/communities/{communityId}/incidents:
   *   get:
   *     summary: Listar incidencias de una comunidad
   *     tags: [Incidents]
   *     parameters:
   *       - in: path
   *         name: communityId
   *         required: true
   *         schema: { type: string, format: uuid }
   *       - in: query
   *         name: status
   *         schema: { $ref: '#/components/schemas/IncidentStatus' }
   *       - in: query
   *         name: priority
   *         schema: { $ref: '#/components/schemas/IncidentPriority' }
   *       - in: query
   *         name: page
   *         schema: { type: integer, minimum: 1, default: 1 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
   *     responses:
   *       200:
   *         description: Lista paginada de incidencias.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/IncidentListResponse' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   */
  router.get('/:communityId/incidents', requireAuth, requireCommunity(), controller.listIncidents)

  /**
   * @swagger
   * /api/v1/communities/{communityId}/incidents:
   *   post:
   *     summary: Crear una incidencia
   *     description: |
   *       Requiere rol NEIGHBOR, PRESIDENT o ADMIN en la comunidad. Un
   *       PROVIDER no puede abrir partes: solo comenta y gestiona los suyos.
   *     tags: [Incidents]
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
   *             required: [title, category, priority]
   *             properties:
   *               title: { type: string, minLength: 1, maxLength: 200 }
   *               description: { type: string, nullable: true }
   *               category: { $ref: '#/components/schemas/IncidentCategory' }
   *               priority: { $ref: '#/components/schemas/IncidentPriority' }
   *               location: { type: string, nullable: true, example: 'Portal A, 3º B' }
   *     responses:
   *       201:
   *         description: Incidencia creada.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Incident' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   */
  router.post(
    '/:communityId/incidents',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('NEIGHBOR', 'PRESIDENT', 'ADMIN'),
    controller.createIncident,
  )

  return router
}

export function createIncidentRouter(): Router {
  const router = Router()

  /**
   * @swagger
   * /api/v1/incidents/{id}:
   *   get:
   *     summary: Detalle de una incidencia
   *     tags: [Incidents]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200:
   *         description: Incidencia.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Incident' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.get('/incidents/:id', requireAuth, requireIncident(), controller.getIncident)

  /**
   * @swagger
   * /api/v1/incidents/{id}:
   *   put:
   *     summary: Actualizar una incidencia
   *     description: |
   *       El rol se comprueba en `app_update_incident()` con la fila delante:
   *       un vecino solo puede editar su parte mientras siga abierto; un
   *       ADMIN puede editar cualquiera.
   *     tags: [Incidents]
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
   *               title: { type: string, minLength: 1, maxLength: 200 }
   *               description: { type: string, nullable: true }
   *               category: { $ref: '#/components/schemas/IncidentCategory' }
   *               priority: { $ref: '#/components/schemas/IncidentPriority' }
   *               location: { type: string, nullable: true }
   *               assignedToId: { type: string, format: uuid, nullable: true }
   *     responses:
   *       200:
   *         description: Incidencia actualizada.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Incident' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.put('/incidents/:id', requireAuth, requireIncident(), controller.updateIncident)

  /**
   * @swagger
   * /api/v1/incidents/{id}/status:
   *   patch:
   *     summary: Cambiar el estado de una incidencia
   *     description: |
   *       Transiciones permitidas: OPEN → IN_PROGRESS → RESOLVED.
   *       El 403 (rol) y el 409 (transición inválida) los decide
   *       `app_transition_incident()`, con la fila delante.
   *     tags: [Incidents]
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
   *             required: [status]
   *             properties:
   *               status: { $ref: '#/components/schemas/IncidentStatus' }
   *     responses:
   *       200:
   *         description: Estado actualizado.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Incident' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       404: { $ref: '#/components/responses/NotFound' }
   *       409: { $ref: '#/components/responses/Conflict' }
   */
  router.patch(
    '/incidents/:id/status',
    requireAuth,
    requireIncident(),
    controller.transitionIncident,
  )

  /**
   * @swagger
   * /api/v1/incidents/{id}:
   *   delete:
   *     summary: Eliminar una incidencia (soft delete)
   *     description: Requiere rol ADMIN. El 403 lo emite `app_soft_delete_incident()`.
   *     tags: [Incidents]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       204:
   *         description: Incidencia eliminada.
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.delete('/incidents/:id', requireAuth, requireIncident(), controller.deleteIncident)

  /**
   * @swagger
   * /api/v1/incidents/{id}/comments:
   *   get:
   *     summary: Listar comentarios de una incidencia
   *     description: |
   *       Los comentarios `isInternal=true` solo se devuelven a
   *       PRESIDENT/ADMIN/PROVIDER asignado.
   *     tags: [Incidents]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200:
   *         description: Lista de comentarios.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/IncidentCommentListResponse' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.get('/incidents/:id/comments', requireAuth, requireIncident(), controller.listComments)

  /**
   * @swagger
   * /api/v1/incidents/{id}/comments:
   *   post:
   *     summary: Añadir un comentario a una incidencia
   *     tags: [Incidents]
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
   *             required: [body]
   *             properties:
   *               body: { type: string, minLength: 1 }
   *               isInternal: { type: boolean, default: false }
   *     responses:
   *       201:
   *         description: Comentario creado.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/IncidentComment' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.post('/incidents/:id/comments', requireAuth, requireIncident(), controller.createComment)

  return router
}
