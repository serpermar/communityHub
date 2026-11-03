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

  /**
   * @swagger
   * /api/v1/communities:
   *   get:
   *     summary: Listar las comunidades del usuario
   *     description: |
   *       Solo devuelve las comunidades donde el usuario es miembro (RLS
   *       `communities_member`). Cada item incluye `memberRole`, que es el rol
   *       del usuario autenticado DENTRO de esa comunidad (no el `globalRole`).
   *     tags: [Communities]
   *     responses:
   *       200:
   *         description: Comunidades del usuario.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/CommunityListResponse' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   */
  router.get('/', requireAuth, controller.list)

  /**
   * @swagger
   * /api/v1/communities:
   *   post:
   *     summary: Crear una comunidad
   *     description: |
   *       Requiere rol global de administrador (`requireGlobalAdmin`). El
   *       creador pasa a ser ADMIN de la comunidad nueva.
   *     tags: [Communities]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [name, addressLine1, city, province, postalCode, country]
   *             properties:
   *               name:
   *                 type: string
   *                 minLength: 1
   *                 maxLength: 200
   *               description:
   *                 type: string
   *                 nullable: true
   *               addressLine1:
   *                 type: string
   *                 minLength: 1
   *               city:
   *                 type: string
   *                 minLength: 1
   *               province:
   *                 type: string
   *                 minLength: 1
   *               postalCode:
   *                 type: string
   *                 minLength: 1
   *               country:
   *                 type: string
   *                 description: Código ISO 3166-1 alpha-2.
   *                 example: ES
   *               latitude:
   *                 type: number
   *                 format: float
   *                 nullable: true
   *               longitude:
   *                 type: number
   *                 format: float
   *                 nullable: true
   *               timezone:
   *                 type: string
   *                 default: Europe/Madrid
   *               registrationNumber:
   *                 type: string
   *                 nullable: true
   *     responses:
   *       201:
   *         description: Comunidad creada.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Community' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   */
  router.post('/', requireAuth, requireGlobalAdmin(), controller.create)

  /**
   * @swagger
   * /api/v1/communities/by-slug/{slug}:
   *   get:
   *     summary: Obtener una comunidad por su slug
   *     description: |
   *       Búsqueda por slug en vez de por UUID. Útil para URLs amigables y
   *       para el flujo de invitación. Devuelve 404 si el usuario no es
   *       miembro (RLS).
   *     tags: [Communities]
   *     parameters:
   *       - in: path
   *         name: slug
   *         required: true
   *         schema: { type: string, example: alfons-13 }
   *     responses:
   *       200:
   *         description: Comunidad.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Community' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  // NUEVA RUTA: Buscar por slug (debe ir antes que /:communityId)
  router.get('/by-slug/:slug', requireAuth, controller.getBySlug)

  /**
   * @swagger
   * /api/v1/communities/{communityId}:
   *   get:
   *     summary: Detalle de una comunidad
   *     tags: [Communities]
   *     parameters:
   *       - in: path
   *         name: communityId
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200:
   *         description: Comunidad.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Community' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.get('/:communityId', requireAuth, requireCommunity(), controller.getOne)

  /**
   * @swagger
   * /api/v1/communities/{communityId}:
   *   patch:
   *     summary: Actualizar una comunidad
   *     description: Requiere rol ADMIN en la comunidad.
   *     tags: [Communities]
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
   *             properties:
   *               name:
   *                 type: string
   *                 minLength: 1
   *                 maxLength: 200
   *               description:
   *                 type: string
   *                 nullable: true
   *               addressLine1:
   *                 type: string
   *                 minLength: 1
   *               city:
   *                 type: string
   *                 minLength: 1
   *               province:
   *                 type: string
   *                 minLength: 1
   *               postalCode:
   *                 type: string
   *                 minLength: 1
   *               country:
   *                 type: string
   *                 example: ES
   *               latitude:
   *                 type: number
   *                 format: float
   *                 nullable: true
   *               longitude:
   *                 type: number
   *                 format: float
   *                 nullable: true
   *               timezone:
   *                 type: string
   *               registrationNumber:
   *                 type: string
   *                 nullable: true
   *               isActive:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: Comunidad actualizada.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Community' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.patch(
    '/:communityId',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('ADMIN'),
    controller.update,
  )

  return router
}
