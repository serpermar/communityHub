// ---------------------------------------------------------------------------
// Ruta del dashboard (spec 13 §6).
//
// Una sola ruta, con la comunidad en la URL:
//
//   GET /communities/:communityId/dashboard   requireAuth + requireCommunity()
//
// El orden de los middleware ES la autorizacion: `requireAuth` demuestra quien
// eres y `requireCommunity()` que perteneces a la comunidad (C-8, C-9). NO hay
// `requireCommunityRole`: el dashboard es para cualquier miembro activo (DSH-2);
// la unica asimetria por rol esta DENTRO de la respuesta (finance solo ADMIN,
// DSH-3) y la decide la funcion.
// ---------------------------------------------------------------------------

import { Router } from 'express'
import { requireAuth, requireCommunity } from '../auth/middleware.js'
import * as controller from './controller.js'

/** `GET /communities/:communityId/dashboard`. */
export function createDashboardRouter(): Router {
  const router = Router()

  router.get('/:communityId/dashboard', requireAuth, requireCommunity(), controller.getDashboard)

  return router
}
