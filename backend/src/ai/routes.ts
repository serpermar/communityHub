// ---------------------------------------------------------------------------
// Rutas de IA.
//
// Un unico router montado en `/api/v1/ai`, sin `:communityId` en la URL (D-1):
// el prefijo de dos routers del resto de bloques existe para las URLs de
// comunidad, y aqui la comunidad va en el cuerpo. Todas las rutas exigen sesion.
//
// Las nueve rutas del bloque (spec §7.1). `requireChatSession` solo en las dos de
// sesion por id; `requireDraft` solo en el confirm. El resto delega la
// comprobacion de pertenencia al cuerpo en el service.
// ---------------------------------------------------------------------------

import { Router } from 'express'
import { requireAuth } from '../auth/middleware.js'
import * as controller from './controller.js'
import { requireChatSession, requireDraft } from './middleware.js'

export function createAiRouter(): import('express').Router {
  const router = Router()

  router.use(requireAuth)

  // Chat y sesiones (AI-7, AI-11)
  router.post('/chat', controller.chat)
  router.get('/chat/sessions', controller.listSessions)
  router.get('/chat/sessions/:id/messages', requireChatSession(), controller.listMessages)
  router.delete('/chat/sessions/:id', requireChatSession(), controller.deleteSession)

  // Asistente de incidencias (AI-2, AI-14)
  router.post('/incidents/classify', controller.classify)
  router.post('/incidents/drafts', controller.createDraft)
  router.post('/incidents/drafts/:id/confirm', requireDraft(), controller.confirmDraft)

  // Catalogo de tools (AI-9, AI-10)
  router.get('/tools', controller.listTools)
  router.post('/tools/:toolName/preview', controller.previewTool)

  return router
}
