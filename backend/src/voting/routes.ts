// ---------------------------------------------------------------------------
// Rutas de votaciones.
//
// En DOS routers por la misma razon que los bloques 05-09: las rutas de
// comunidad cuelgan de `/api/v1/communities` y las de voto por id de
// `/api/v1`. El orden de los middleware ES la autorizacion:
//
//   GET    /communities/:communityId/votes                     requireAuth + requireCommunity()
//   POST   /communities/:communityId/votes                     requireAuth + requireCommunity() + PRESIDENT/ADMIN
//   GET    /votes/:id                                          requireAuth + requireVote()
//   PATCH  /votes/:id                                          requireAuth + requireVote()
//   POST   /votes/:id/publish                                  requireAuth + requireVote()
//   POST   /votes/:id/close                                    requireAuth + requireVote()
//   POST   /votes/:id/responses                                requireAuth + requireVote()
//   GET    /votes/:id/results                                  requireAuth + requireVote()
//   GET    /votes/:id/results/export                           requireAuth + requireVote()
//
// Tres decisiones, ninguna nueva (spec 10 §7.2):
//
//   1. Las rutas por id NO llevan `requireCommunity()` ni un guard de rol:
//      `requireVote()` resuelve la comunidad y da el 404 de visibilidad, y
//      cada funcion decide el rol dentro de la transaccion.
//
//   2. El listado de comunidad SI lleva `requireCommunity()` como chequeo
//      grueso; el 403 de un PROVIDER o un no-miembro lo da la funcion
//      `app_list_votes()` (V-5).
//
//   3. El alta SI lleva `requireCommunityRole('PRESIDENT','ADMIN')` como
//      chequeo grueso; la funcion lo repite dentro.
//
// No hay `DELETE /votes/:id` (V-14).
// ---------------------------------------------------------------------------

import { Router } from 'express'
import { requireAuth, requireCommunity, requireCommunityRole } from '../auth/middleware.js'
import { requireVote } from './middleware.js'
import * as controller from './controller.js'

/** Rutas con la comunidad en la URL (listar y crear). */
export function createVotesRouter(): Router {
  const router = Router()

  /**
   * @swagger
   * /api/v1/communities/{communityId}/votes:
   *   get:
   *     summary: Listar votaciones de una comunidad
   *     description: |
   *       El alcance y el 403 lo decide `app_list_votes()` (V-5): un PROVIDER
   *       o un no-miembro reciben 403 desde la función, no desde un guard.
   *     tags: [Votes]
   *     parameters:
   *       - in: path
   *         name: communityId
   *         required: true
   *         schema: { type: string, format: uuid }
   *       - in: query
   *         name: status
   *         schema: { $ref: '#/components/schemas/VoteStatus' }
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 1 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 20 }
   *     responses:
   *       200:
   *         description: Lista paginada de votaciones.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/VoteListResponse' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   */
  router.get('/:communityId/votes', requireAuth, requireCommunity(), controller.listVotes)

  /**
   * @swagger
   * /api/v1/communities/{communityId}/votes:
   *   post:
   *     summary: Crear una votación
   *     description: Requiere rol PRESIDENT o ADMIN. La votación nace en DRAFT.
   *     tags: [Votes]
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
   *             required: [title, question, type, options, startsAt, endsAt]
   *             properties:
   *               title: { type: string, minLength: 1, maxLength: 200 }
   *               question: { type: string, minLength: 1 }
   *               description: { type: string, nullable: true }
   *               type: { $ref: '#/components/schemas/VoteType' }
   *               options:
   *                 type: array
   *                 minItems: 2
   *                 items:
   *                   type: object
   *                   required: [label]
   *                   properties:
   *                     label: { type: string, minLength: 1 }
   *               startsAt: { type: string, format: date-time }
   *               endsAt: { type: string, format: date-time }
   *               allowAbstention: { type: boolean, default: false }
   *               quorumPercent: { type: integer, minimum: 1, maximum: 100, nullable: true }
   *               resultVisibility: { $ref: '#/components/schemas/VoteResultVisibility' }
   *     responses:
   *       201:
   *         description: Votación creada.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Vote' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   */
  router.post(
    '/:communityId/votes',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('PRESIDENT', 'ADMIN'),
    controller.createVote,
  )

  return router
}

/**
 * Rutas con el voto en la URL. `requireVote()` sustituye a `requireCommunity()`:
 * resuelve la comunidad con `app_vote_community()` y da 404 si no es visible.
 * Ninguna lleva guard de rol: decidirlo fuera de la transaccion duplicaria la
 * regla.
 */
export function createVoteRouter(): Router {
  const router = Router()

  /**
   * @swagger
   * /api/v1/votes/{id}:
   *   get:
   *     summary: Detalle de una votación
   *     description: 404 si la votación no es visible para el usuario (DRAFT ajeno).
   *     tags: [Votes]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200:
   *         description: Votación.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Vote' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.get('/votes/:id', requireAuth, requireVote(), controller.getVote)

  /**
   * @swagger
   * /api/v1/votes/{id}:
   *   patch:
   *     summary: Actualizar una votación (solo en DRAFT)
   *     description: |
   *       Requiere ser PRESIDENT/ADMIN. La comprobación de rol y estado se hace
   *       dentro de la transacción.
   *     tags: [Votes]
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
   *               question: { type: string, minLength: 1 }
   *               description: { type: string, nullable: true }
   *               type: { $ref: '#/components/schemas/VoteType' }
   *               options:
   *                 type: array
   *                 minItems: 2
   *                 items:
   *                   type: object
   *                   required: [label]
   *                   properties:
   *                     label: { type: string, minLength: 1 }
   *               startsAt: { type: string, format: date-time }
   *               endsAt: { type: string, format: date-time }
   *               allowAbstention: { type: boolean }
   *               quorumPercent: { type: integer, minimum: 1, maximum: 100, nullable: true }
   *               resultVisibility: { $ref: '#/components/schemas/VoteResultVisibility' }
   *     responses:
   *       200:
   *         description: Votación actualizada.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Vote' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       404: { $ref: '#/components/responses/NotFound' }
   *       409: { $ref: '#/components/responses/Conflict' }
   */
  router.patch('/votes/:id', requireAuth, requireVote(), controller.updateVote)

  /**
   * @swagger
   * /api/v1/votes/{id}/publish:
   *   post:
   *     summary: Publicar una votación (DRAFT → PUBLISHED/OPEN)
   *     description: Requiere ser PRESIDENT/ADMIN.
   *     tags: [Votes]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200:
   *         description: Votación publicada.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Vote' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       409: { $ref: '#/components/responses/Conflict' }
   */
  router.post('/votes/:id/publish', requireAuth, requireVote(), controller.publishVote)

  /**
   * @swagger
   * /api/v1/votes/{id}/close:
   *   post:
   *     summary: Cerrar una votación
   *     description: Requiere ser PRESIDENT/ADMIN.
   *     tags: [Votes]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200:
   *         description: Votación cerrada.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Vote' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       409: { $ref: '#/components/responses/Conflict' }
   */
  router.post('/votes/:id/close', requireAuth, requireVote(), controller.closeVote)

  /**
   * @swagger
   * /api/v1/votes/{id}/responses:
   *   post:
   *     summary: Emitir un voto
   *     tags: [Votes]
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
   *             required: [optionId]
   *             properties:
   *               optionId: { type: string, format: uuid }
   *     responses:
   *       201:
   *         description: Voto emitido.
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       404: { $ref: '#/components/responses/NotFound' }
   *       409: { $ref: '#/components/responses/Conflict' }
   */
  router.post('/votes/:id/responses', requireAuth, requireVote(), controller.castVote)

  /**
   * @swagger
   * /api/v1/votes/{id}/results:
   *   get:
   *     summary: Resultados de una votación
   *     description: Solo disponible cuando la votación está cerrada.
   *     tags: [Votes]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200:
   *         description: Resultados.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/VoteResult' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       404: { $ref: '#/components/responses/NotFound' }
   *       409: { $ref: '#/components/responses/Conflict' }
   */
  router.get('/votes/:id/results', requireAuth, requireVote(), controller.getResults)

  /**
   * @swagger
   * /api/v1/votes/{id}/results/export:
   *   get:
   *     summary: Exportar los resultados (CSV/JSON)
   *     description: Solo PRESIDENT/ADMIN.
   *     tags: [Votes]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200:
   *         description: Volcado de votos emitidos.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/VoteResultExport' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.get('/votes/:id/results/export', requireAuth, requireVote(), controller.exportResults)

  return router
}
