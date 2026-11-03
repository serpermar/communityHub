// (cabecera original sin cambios)

import { Router } from 'express'
import { requireAuth } from '../auth/middleware.js'
import * as controller from './controller.js'
import { requireChatSession, requireDraft } from './middleware.js'

export function createAiRouter(): import('express').Router {
  const router = Router()

  router.use(requireAuth)

  /**
   * @swagger
   * /api/v1/ai/chat:
   *   post:
   *     summary: Chat con el asistente IA
   *     description: |
   *       Requiere cuota diaria. Si `AI_ENABLED=false` o no hay claves, responde
   *       en modo degradado (AI-3).
   *     tags: [AI]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/AiChatRequest' }
   *     responses:
   *       200:
   *         description: Respuesta del asistente.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/AiChatResponse' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       429: { $ref: '#/components/responses/RateLimited' }
   */
  router.post('/chat', controller.chat)

  /**
   * @swagger
   * /api/v1/ai/chat/sessions:
   *   get:
   *     summary: Listar sesiones de chat del usuario
   *     tags: [AI]
   *     responses:
   *       200:
   *         description: Sesiones del usuario.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/ChatSessionListResponse' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   */
  router.get('/chat/sessions', controller.listSessions)

  /**
   * @swagger
   * /api/v1/ai/chat/sessions/{id}/messages:
   *   get:
   *     summary: Listar mensajes de una sesión
   *     tags: [AI]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200:
   *         description: Mensajes.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/ChatMessageListResponse' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.get('/chat/sessions/:id/messages', requireChatSession(), controller.listMessages)

  /**
   * @swagger
   * /api/v1/ai/chat/sessions/{id}:
   *   delete:
   *     summary: Eliminar una sesión de chat
   *     tags: [AI]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       204:
   *         description: Sesión eliminada.
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.delete('/chat/sessions/:id', requireChatSession(), controller.deleteSession)

  /**
   * @swagger
   * /api/v1/ai/incidents/classify:
   *   post:
   *     summary: Clasificar una descripción de incidencia
   *     description: Devuelve categoría, prioridad y `needsHumanReview`.
   *     tags: [AI]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [description]
   *             properties:
   *               description: { type: string, minLength: 1 }
   *     responses:
   *       200:
   *         description: Clasificación.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/IncidentClassification' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   */
  router.post('/incidents/classify', controller.classify)

  /**
   * @swagger
   * /api/v1/ai/incidents/drafts:
   *   post:
   *     summary: Crear un borrador de incidencia asistido por IA
   *     tags: [AI]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [description, communityId]
   *             properties:
   *               communityId: { type: string, format: uuid }
   *               description: { type: string }
   *     responses:
   *       201:
   *         description: Borrador creado.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/IncidentDraft' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   */
  router.post('/incidents/drafts', controller.createDraft)

  /**
   * @swagger
   * /api/v1/ai/incidents/drafts/{id}/confirm:
   *   post:
   *     summary: Confirmar un borrador y crear la incidencia
   *     tags: [AI]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       201:
   *         description: Incidencia creada a partir del borrador.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Incident' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.post('/incidents/drafts/:id/confirm', requireDraft(), controller.confirmDraft)

  /**
   * @swagger
   * /api/v1/ai/tools:
   *   get:
   *     summary: Catálogo de tools disponibles
   *     tags: [AI]
   *     responses:
   *       200:
   *         description: Catálogo.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/ToolListResponse' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   */
  router.get('/tools', controller.listTools)

  /**
   * @swagger
   * /api/v1/ai/tools/{toolName}/preview:
   *   post:
   *     summary: Ejecutar una tool en modo preview (solo lectura)
   *     tags: [AI]
   *     parameters:
   *       - in: path
   *         name: toolName
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { type: object, additionalProperties: true }
   *     responses:
   *       200:
   *         description: Resultado.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/ToolPreviewResponse' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.post('/tools/:toolName/preview', controller.previewTool)

  return router
}
