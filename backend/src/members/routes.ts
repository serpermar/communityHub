// ---------------------------------------------------------------------------
// Rutas de miembros e invitaciones.
//
// Se montan con `app.use('/api/v1/communities', ...)` y con
// `app.use('/api/v1/invitations', ...)`, y las rutas se escriben COMPLETAS dentro
// de cada router, en vez de montar un router en un camino con parametros
// (`app.use('/communities/:communityId/members', ...)`). Las dos formas funcionan,
// y se elige esta porque es la que ya usa el bloque 02 y porque deja claro que las
// rutas de comunidad cuelgan del mismo sitio que las de `/communities/:communityId`.
// Un router que no encuentra su camino pasa al siguiente, asi que el orden de los
// dos montajes en app.ts es el de las rutas y no importa.
//
// El orden de los middleware ES la autorizacion:
//
//   GET    /communities/:communityId/members             requireAuth + requireCommunity
//   GET    /communities/:communityId/members/:memberId   requireAuth + requireCommunity
//   PATCH  /communities/:communityId/members/:memberId   + requireCommunityRole('ADMIN')
//   POST   /communities/:communityId/invitations         + requireCommunityRole('ADMIN')
//   GET    /communities/:communityId/invitations         + requireCommunityRole('ADMIN')
//   DELETE /communities/:communityId/invitations/:id     + requireCommunityRole('ADMIN')
//   POST   /invitations/redeem                           requireAuth
//
// Los dos guards de comunidad van SIEMPRE en ese orden. `requireCommunityRole`
// lee `req.community`, que escribe `requireCommunity`: puesto al reves, todavia no
// habria comunidad y todo el mundo recibiria un 401.
//
// Que listar miembros NO pida ADMIN es deliberado (spec 03, seccion 6): es el caso
// de uso principal ("¿el tecnico ya tiene acceso?") y el `PROVIDER` lo necesita.
//
// Y `/invitations/redeem` es la unica que no lleva `requireCommunity`: al canjear
// no se sabe todavia en que comunidad se entra, y la comunidad la decide el codigo.
// ---------------------------------------------------------------------------

import { Router } from 'express'
import * as controller from './controller.js'
import { requireAuth, requireCommunity, requireCommunityRole } from '../auth/middleware.js'

/**
 * Rutas de miembros de una comunidad.
 *
 * `/communities/:communityId/members` y `/communities/:communityId/members/:memberId`.
 */
export function createMembersRouter(): Router {
  const router = Router()

  router.get('/:communityId/members', requireAuth, requireCommunity(), controller.listMembers)
  router.get('/:communityId/members/:memberId', requireAuth, requireCommunity(), controller.getMember)

  // `requireCommunity()` antes que `requireCommunityRole('ADMIN')`: el guard de rol
  // lee `req.community`, que escribe el primero.
  router.patch(
    '/:communityId/members/:memberId',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('ADMIN'),
    controller.patchMember,
  )

  return router
}

/**
 * Rutas de invitaciones de una comunidad.
 *
 * Las tres de dentro de la comunidad son de ADMIN (M-2): invitar, ver las
 * invitaciones y anularlas. Verlas incluye ver las ya usadas, que es el historial
 * de a quien invito cada ADMIN.
 */
export function createInvitationsRouter(): Router {
  const router = Router()

  router.post(
    '/:communityId/invitations',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('ADMIN'),
    controller.createInvitation,
  )

  router.get(
    '/:communityId/invitations',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('ADMIN'),
    controller.listInvitations,
  )

  router.delete(
    '/:communityId/invitations/:invitationId',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('ADMIN'),
    controller.deleteInvitation,
  )

  return router
}

/**
 * Canje de un codigo (M-10).
 *
 * Ruta aparte y autenticada. `requireAuth` y nada mas: la pertenencia a la
 * comunidad es justo lo que se va a conseguir.
 */
export function createInvitationRedeemRouter(): Router {
  const router = Router()

  router.post('/redeem', requireAuth, controller.redeemInvitation)

  return router
}