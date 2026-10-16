// ---------------------------------------------------------------------------
// Rutas de notificaciones (spec 14 §6).
//
// Cuatro rutas bajo `/api/v1/notifications`, TODAS con `requireAuth` y ninguna
// con `requireCommunity`: son del usuario, no de una comunidad (NTF-3). El
// `read-all` y el `unread-count` van ANTES de `/:id/read` en el orden de
// declaracion por claridad, aunque no colisionan: son verbos y formas distintas.
// ---------------------------------------------------------------------------

import { Router } from 'express'
import { requireAuth } from '../auth/middleware.js'
import * as controller from './controller.js'

export function createNotificationsRouter(): Router {
  const router = Router()

  router.get('/', requireAuth, controller.list)
  router.get('/unread-count', requireAuth, controller.unreadCount)
  router.patch('/:id/read', requireAuth, controller.markRead)
  router.post('/read-all', requireAuth, controller.readAll)

  return router
}
