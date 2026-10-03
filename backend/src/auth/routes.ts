// ---------------------------------------------------------------------------
// Rutas de autenticacion.
//
// Prefijo /api/v1/auth. El orden importa: `requireAuth` antes que el controller,
// siempre. Un endpoint que no lo lleve es un endpoint publico, y eso tiene que
// ser una decision consciente, no un olvido.
// ---------------------------------------------------------------------------

import { Router } from 'express'
import * as controller from './controller.js'
import { requireAuth } from './middleware.js'
import { createLoginRateLimiter } from '../http/ratelimit.js'

export function createAuthRouter(): Router {
  const router = Router()
  const loginLimiter = createLoginRateLimiter()

  // Publicos. El limite de intentos va solo en el login: el registro tambien
  // escribe en la base de datos, pero un 429 ahi impediria dar de alta a varias
  // personas desde la misma IP, que en un portal de una comunidad es el caso
  // normal (mismo router, mismo vecindario).
  router.post('/register', controller.register)
  router.post('/login', loginLimiter, controller.login)
  router.post('/refresh', controller.refresh)

  // Protegidos.
  router.post('/logout', requireAuth, controller.logout)
  router.get('/me', requireAuth, controller.me)
  router.get('/sessions', requireAuth, controller.listSessions)
  router.delete('/sessions/:id', requireAuth, controller.revokeSession)

  return router
}