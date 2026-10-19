// ---------------------------------------------------------------------------
// Rutas de APIs externas (spec 12 §7).
//
// Un solo router, las tres rutas cuelgan de la comunidad:
//
//   GET  /:communityId/weather  requireAuth + requireCommunity()
//   GET  /:communityId/map      requireAuth + requireCommunity()
//   POST /:communityId/geocode  requireAuth + requireCommunity() + ADMIN
//
// Los dos guards van SIEMPRE en ese orden: `requireCommunityRole` lee
// `req.community`, que escribe `requireCommunity` (y ademas valida que el id sea
// un UUID antes de tocar la base de datos, C-9).
//
// `weather` y `map` los puede usar cualquier miembro activo, proveedor incluido:
// son datos del barrio, no configuracion. `geocode` es el unico que escribe y por
// eso pide ADMIN.
// ---------------------------------------------------------------------------

import { Router } from 'express'
import * as controller from './controller.js'
import { requireAuth, requireCommunity, requireCommunityRole } from '../auth/middleware.js'

export function createExternalRouter(): Router {
  const router = Router()

  router.get('/:communityId/weather', requireAuth, requireCommunity(), controller.weather)
  router.get('/:communityId/map', requireAuth, requireCommunity(), controller.map)
  router.post(
    '/:communityId/geocode',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('ADMIN'),
    controller.geocode,
  )

  return router
}
