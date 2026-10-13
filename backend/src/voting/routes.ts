// ---------------------------------------------------------------------------
// Rutas de votaciones.
//
// En DOS routers por la misma razon que los bloques 05-09: las rutas de
// comunidad cuelgan de `/api/v1/communities` y las de voto por id de
// `/api/v1`. El orden de los middleware ES la autorizacion:
//
//   GET    /communities/:communityId/votes                     requireAuth + requireCommunity()
//   POST   /communities/:communityId/votes                     requireAuth + requireCommunity() + PRESIDENT/ADMIN
//   GET    /votes/:id                                          requireAuth + requireVote()
//   PATCH  /votes/:id                                          requireAuth + requireVote()
//   POST   /votes/:id/publish                                  requireAuth + requireVote()
//   POST   /votes/:id/close                                    requireAuth + requireVote()
//   POST   /votes/:id/responses                                requireAuth + requireVote()
//   GET    /votes/:id/results                                  requireAuth + requireVote()
//   GET    /votes/:id/results/export                           requireAuth + requireVote()
//
// Tres decisiones, ninguna nueva (spec 10 §7.2):
//
//   1. Las rutas por id NO llevan `requireCommunity()` (no hay `:communityId` en
//      la URL) ni un guard de rol: `requireVote()` resuelve la comunidad y da el
//      404 de visibilidad, y cada funcion decide el rol dentro de la transaccion.
//      Editar sin ser PRESIDENT/ADMIN da 404 si la votacion no le es visible (un
//      DRAFT) y 403 si la ve pero no gestiona (una OPEN); nunca un guard lo
//      decidiria mejor.
//
//   2. El listado de comunidad SI lleva `requireCommunity()` como chequeo
//      grueso; el 403 de un PROVIDER o un no-miembro lo da la funcion
//      `app_list_votes()` (V-5), no un guard, porque un guard daria el mismo 403
//      con un mensaje peor y dejaria el endpoint abierto por PostgREST.
//
//   3. El alta SI lleva `requireCommunityRole('PRESIDENT','ADMIN')` como chequeo
//      grueso; la funcion lo repite dentro.
//
// No hay `DELETE /votes/:id` (V-14).
// ---------------------------------------------------------------------------

import { Router } from 'express'
import { requireAuth, requireCommunity, requireCommunityRole } from '../auth/middleware.js'
import { requireVote } from './middleware.js'
import * as controller from './controller.js'

/** Rutas con la comunidad en la URL (listar y crear). */
export function createVotesRouter(): Router {
  const router = Router()

  router.get('/:communityId/votes', requireAuth, requireCommunity(), controller.listVotes)
  router.post(
    '/:communityId/votes',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('PRESIDENT', 'ADMIN'),
    controller.createVote,
  )

  return router
}

/**
 * Rutas con el voto en la URL. `requireVote()` sustituye a `requireCommunity()`:
 * resuelve la comunidad con `app_vote_community()` y da 404 si no es visible.
 * Ninguna lleva guard de rol: decidirlo fuera de la transaccion duplicaria la
 * regla.
 */
export function createVoteRouter(): Router {
  const router = Router()

  router.get('/votes/:id', requireAuth, requireVote(), controller.getVote)
  router.patch('/votes/:id', requireAuth, requireVote(), controller.updateVote)
  router.post('/votes/:id/publish', requireAuth, requireVote(), controller.publishVote)
  router.post('/votes/:id/close', requireAuth, requireVote(), controller.closeVote)
  router.post('/votes/:id/responses', requireAuth, requireVote(), controller.castVote)
  router.get('/votes/:id/results', requireAuth, requireVote(), controller.getResults)
  router.get('/votes/:id/results/export', requireAuth, requireVote(), controller.exportResults)

  return router
}
