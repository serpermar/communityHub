import { Router } from 'express'
import * as controller from './controller.js'
import {
  requireAuth,
  requireCommunity,
  requireCommunityRole,
  requireGlobalAdmin,
} from '../auth/middleware.js'

export function createCommunitiesRouter(): Router {
  const router = Router()

  router.get('/', requireAuth, controller.list)
  router.post('/', requireAuth, requireGlobalAdmin(), controller.create)

  // NUEVA RUTA: Buscar por slug (debe ir antes que /:communityId)
  router.get('/by-slug/:slug', requireAuth, controller.getBySlug)

  router.get('/:communityId', requireAuth, requireCommunity(), controller.getOne)
  router.patch(
    '/:communityId',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('ADMIN'),
    controller.update,
  )

  return router
}
