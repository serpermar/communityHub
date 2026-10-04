// ---------------------------------------------------------------------------
// Rutas de comunidades.
//
// Prefijo /api/v1/communities. El orden de los middleware ES la autorizacion:
//
//   GET  /                    requireAuth
//   POST /                    requireAuth + requireGlobalAdmin
//   GET  /:communityId        requireAuth + requireCommunity
//   PATCH /:communityId       requireAuth + requireCommunity + requireCommunityRole('ADMIN')
//
// Los dos guards de comunidad van SIEMPRE en ese orden. `requireCommunityRole`
// lee `req.community`, que escribe `requireCommunity`: puesto al reves, todavia
// no habria comunidad y todo el mundo recibiria un 401.
//
// `requireCommunity` va antes que el controller, y por eso el id mal formado es
// un 400 antes de abrir transaccion (C-9).
// ---------------------------------------------------------------------------

import { Router } from 'express'
import * as controller from './controller.js'
import { requireAuth, requireCommunity, requireCommunityRole, requireGlobalAdmin } from '../auth/middleware.js'

export function createCommunitiesRouter(): Router {
  const router = Router()

  router.get('/', requireAuth, controller.list)
  // `requireGlobalAdmin()` CON parentesis, y no sin ellos como estaba antes.
  // `requireGlobalAdmin` es una fabrica: devuelve el middleware. Sin los
  // parentesis se le pasa a Express la fabrica, que recibe (req, res, next),
  // devuelve una funcion async que nadie llega a llamar, y se traga la peticion
  // sin responder nunca. De ahi que el POST se colgara en vez de dar 403: no era
  // un fallo de autorizacion, era un middleware que nunca se ejecutaba.
  // Los guards de comunidad si llevan parentesis (`requireCommunity()`); este se
  // quedaba sin ellos.
  router.post('/', requireAuth, requireGlobalAdmin(), controller.create)

  router.get('/:communityId', requireAuth, requireCommunity(), controller.getOne)
  router.patch('/:communityId', requireAuth, requireCommunity(), requireCommunityRole('ADMIN'), controller.update)

  return router
}
