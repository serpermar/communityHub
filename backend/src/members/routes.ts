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

  /**
   * @swagger
   * /api/v1/communities/{communityId}/members:
   *   get:
   *     summary: Listar miembros de una comunidad
   *     description: |
   *       Cualquier miembro activo puede listar. No requiere ADMIN: es el caso
   *       de uso principal ("¿el técnico ya tiene acceso?"). La visibilidad la
   *       decide RLS `members_of_community`.
   *     tags: [Members]
   *     parameters:
   *       - in: path
   *         name: communityId
   *         required: true
   *         schema: { type: string, format: uuid }
   *       - in: query
   *         name: page
   *         schema: { type: integer, minimum: 1, default: 1 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
   *     responses:
   *       200:
   *         description: Lista paginada de miembros.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/MemberListResponse' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   */
  router.get('/:communityId/members', requireAuth, requireCommunity(), controller.listMembers)

  /**
   * @swagger
   * /api/v1/communities/{communityId}/members/{memberId}:
   *   get:
   *     summary: Detalle de un miembro
   *     tags: [Members]
   *     parameters:
   *       - in: path
   *         name: communityId
   *         required: true
   *         schema: { type: string, format: uuid }
   *       - in: path
   *         name: memberId
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200:
   *         description: Miembro.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Member' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.get(
    '/:communityId/members/:memberId',
    requireAuth,
    requireCommunity(),
    controller.getMember,
  )

  /**
   * @swagger
   * /api/v1/communities/{communityId}/members/{memberId}:
   *   patch:
   *     summary: Cambiar el rol de un miembro
   *     description: Requiere rol ADMIN en la comunidad.
   *     tags: [Members]
   *     parameters:
   *       - in: path
   *         name: communityId
   *         required: true
   *         schema: { type: string, format: uuid }
   *       - in: path
   *         name: memberId
   *         required: true
   *         schema: { type: string, format: uuid }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [role]
   *             properties:
   *               role:
   *                 type: string
   *                 enum: [NEIGHBOR, PRESIDENT, ADMIN]
   *     responses:
   *       200:
   *         description: Rol actualizado.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Member' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
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

  /**
   * @swagger
   * /api/v1/communities/{communityId}/invitations:
   *   post:
   *     summary: Crear una invitación
   *     description: |
   *       Requiere rol ADMIN en la comunidad. Si se define `email`, solo ese
   *       email podrá canjear el código; si no, el código sirve para cualquiera
   *       con el enlace. La respuesta incluye el `code` de canje, que **no** se
   *       devuelve en el listado.
   *     tags: [Invitations]
   *     parameters:
   *       - in: path
   *         name: communityId
   *         required: true
   *         schema: { type: string, format: uuid }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [role]
   *             properties:
   *               role:
   *                 type: string
   *                 enum: [NEIGHBOR, PRESIDENT, ADMIN]
   *                 default: NEIGHBOR
   *               email:
   *                 type: string
   *                 format: email
   *                 description: Si se define, el canje queda limitado a este email.
   *               expiresInDays:
   *                 type: integer
   *                 minimum: 1
   *                 maximum: 90
   *                 default: 7
   *     responses:
   *       201:
   *         description: |
   *           Invitación creada. La respuesta incluye el `code` de canje, que
   *           solo se devuelve aquí y no en el listado.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/InvitationCreatedResponse' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   */
  router.post(
    '/:communityId/invitations',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('ADMIN'),
    controller.createInvitation,
  )

  /**
   * @swagger
   * /api/v1/communities/{communityId}/invitations:
   *   get:
   *     summary: Listar invitaciones de una comunidad
   *     description: Requiere rol ADMIN. Incluye las ya usadas (historial).
   *     tags: [Invitations]
   *     parameters:
   *       - in: path
   *         name: communityId
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200:
   *         description: Lista de invitaciones.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/InvitationListResponse' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   */
  router.get(
    '/:communityId/invitations',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('ADMIN'),
    controller.listInvitations,
  )

  /**
   * @swagger
   * /api/v1/communities/{communityId}/invitations/{invitationId}:
   *   delete:
   *     summary: Anular una invitación
   *     description: Requiere rol ADMIN. Una invitación usada no se puede anular.
   *     tags: [Invitations]
   *     parameters:
   *       - in: path
   *         name: communityId
   *         required: true
   *         schema: { type: string, format: uuid }
   *       - in: path
   *         name: invitationId
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       204:
   *         description: Invitación anulada.
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       404: { $ref: '#/components/responses/NotFound' }
   *       409:
   *         description: La invitación ya fue usada
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/Error' }
   */
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

  /**
   * @swagger
   * /api/v1/invitations/redeem:
   *   post:
   *     summary: Canjear un código de invitación
   *     description: |
   *       El usuario autenticado pasa a ser miembro de la comunidad del código,
   *       con el rol que el código indique. No lleva `requireCommunity`: al
   *       canjear aún no se sabe a qué comunidad se entra; la decide el código.
   *     tags: [Invitations]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [code]
   *             properties:
   *               code:
   *                 type: string
   *                 example: 'A1B2-C3D4-E5F6'
   *     responses:
   *       200:
   *         description: Canje correcto. Devuelve la comunidad a la que se ha entrado.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Community' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       404:
   *         description: Código inválido, expirado o ya usado
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/Error' }
   *       409:
   *         description: El usuario ya es miembro de esa comunidad
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/Error' }
   */
  router.post('/redeem', requireAuth, controller.redeemInvitation)

  return router
}
