// (cabecera original sin cambios)

import { Router } from 'express'
import { requireAuth } from '../auth/middleware.js'
import * as controller from './controller.js'

export function createAgentsRouter(): import('express').Router {
  const router = Router()

  router.use(requireAuth)

  /**
   * @swagger
   * /api/v1/ai/agents:
   *   get:
   *     summary: Listar agentes disponibles
   *     tags: [AI]
   *     responses:
   *       200:
   *         description: Catálogo de agentes.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/AgentListResponse' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   */
  router.get('/', controller.listAgents)

  /**
   * @swagger
   * /api/v1/ai/agents/{name}/run:
   *   post:
   *     summary: Ejecutar un agente
   *     description: |
   *       La pertenencia a la comunidad y el rol se comprueban dentro del
   *       service, porque `communityId` viaja en el cuerpo (D-1).
   *     tags: [AI]
   *     parameters:
   *       - in: path
   *         name: name
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [communityId, input]
   *             properties:
   *               communityId: { type: string, format: uuid }
   *               input: { type: object, additionalProperties: true }
   *     responses:
   *       200:
   *         description: Resultado del agente.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/AgentRunResponse' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       429: { $ref: '#/components/responses/RateLimited' }
   */
  router.post('/:name/run', controller.runAgentHandler)

  return router
}
