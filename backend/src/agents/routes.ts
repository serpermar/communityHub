// ---------------------------------------------------------------------------
// Rutas de los agentes (M-10). Montadas en `/api/v1/ai/agents`.
//
//   GET  /api/v1/ai/agents            -> catalogo de agentes de runtime
//   POST /api/v1/ai/agents/:name/run  -> ejecuta un agente sobre una comunidad
//
// Todas exigen sesion. La pertenencia a la comunidad y el rol del actor se
// comprueban dentro del service, porque la comunidad viaja en el cuerpo (igual
// que el resto del modulo de IA, D-1).
// ---------------------------------------------------------------------------

import { Router } from 'express'
import { requireAuth } from '../auth/middleware.js'
import * as controller from './controller.js'

export function createAgentsRouter(): import('express').Router {
  const router = Router()

  router.use(requireAuth)

  router.get('/', controller.listAgents)
  router.post('/:name/run', controller.runAgentHandler)

  return router
}
