// ---------------------------------------------------------------------------
// Rutas de avisos.
//
// Se montan en DOS routers porque las cuatro rutas no comparten el mismo
// prefijo: las dos de comunidad cuelgan de `/api/v1/communities` y las otras
// dos de `/api/v1`. Los montajes en `app.ts` son dos `app.use` distintos, y el
// orden no importa porque cada router solo atiende las suyas.
//
// Y las rutas se escriben COMPLETAS dentro de cada router, en vez de montar un
// router en un camino con parametros, que es lo que ya hacen los bloques 01-06:
// deja claro que las rutas de comunidad cuelgan del mismo sitio que las de
// `/communities/:communityId`.
//
// El orden de los middleware ES la autorizacion:
//
//   GET    /communities/:communityId/announcements   requireAuth + requireCommunity()
//   POST   /communities/:communityId/announcements   + requireCommunityRole('PRESIDENT','ADMIN')
//   PUT    /announcements/:id                        requireAuth + requireAnnouncement()
//   DELETE /announcements/:id                        requireAuth + requireAnnouncement()
//
// TRES cosas que se ven aqui y que son decisiones, no descuido:
//
//   1. `requireAnnouncement()` va DESPUES de `requireAuth`, siempre. Necesita
//      `req.auth`. Al reves, el 401 seria un TypeError.
//
//   2. `requireAnnouncement()` NO lleva `requireCommunityRole`. El rol lo
//      consulta `app_role_in()` dentro de la transaccion, contra la fila, y
//      quien decide que se puede hacer con ese rol son
//      `app_update_announcement()` y `app_delete_announcement()`.
//
//   3. El POST si lleva `requireCommunityRole('PRESIDENT', 'ADMIN')` como
//      chequeo grueso (AN-1), igual que el POST de incidencias y el de zonas
//      comunes. La funcion lo repite dentro.
//
// El DELETE no lleva `requireCommunityRole('ADMIN')` ni siquiera como chequeo
// grueso, y no es una excepcion caprichosa: es AN-1. El borrado es de ADMIN
// UNICO y el unico que lo dice es `app_delete_announcement()` con
// `announcement_requires_admin`, porque es donde esta la fila y el rol real.
// ---------------------------------------------------------------------------

import { Router } from 'express'
import * as controller from './controller.js'
import { requireAuth, requireCommunity, requireCommunityRole } from '../auth/middleware.js'
import { requireAnnouncement } from './middleware.js'

/**
 * Rutas con la comunidad en la URL.
 *
 * El listado NO lleva `requireCommunityRole`: leer avisos es de cualquier
 * miembro activo (la matriz de ARCHITECTURE.md §5), y la ventana por rol la
 * decide `app_list_announcements()`.
 *
 * El alta si lo lleva, con los dos roles que permiten liderazgo (AN-1).
 */
export function createAnnouncementsRouter(): Router {
  const router = Router()

  /**
   * @swagger
   * /api/v1/communities/{communityId}/announcements:
   *   get:
   *     summary: Listar avisos de una comunidad
   *     description: |
   *       Cualquier miembro activo puede listar. La ventana de visibilidad por
   *       rol (y si un aviso ya expiró) la decide `app_list_announcements()`
   *       dentro de la transacción.
   *     tags: [Announcements]
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
   *         description: Lista paginada de avisos.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/AnnouncementListResponse' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   */
  router.get(
    '/:communityId/announcements',
    requireAuth,
    requireCommunity(),
    controller.listAnnouncements,
  )

  /**
   * @swagger
   * /api/v1/communities/{communityId}/announcements:
   *   post:
   *     summary: Crear un aviso
   *     description: |
   *       Requiere rol PRESIDENT o ADMIN en la comunidad (AN-1). El aviso nace
   *       publicado; la fecha de publicación la fija `publishAt` (o el momento
   *       actual si no se indica).
   *     tags: [Announcements]
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
   *             required: [title, body]
   *             properties:
   *               title: { type: string, minLength: 1, maxLength: 200 }
   *               body: { type: string, minLength: 1 }
   *               type: { $ref: '#/components/schemas/AnnouncementType' }
   *               priority: { $ref: '#/components/schemas/AnnouncementPriority' }
   *               isPinned: { type: boolean, default: false }
   *               minRole: { type: string, enum: [NEIGHBOR, PRESIDENT, ADMIN], default: NEIGHBOR }
   *               publishAt: { type: string, format: date-time, nullable: true }
   *               expiresAt: { type: string, format: date-time, nullable: true }
   *     responses:
   *       201:
   *         description: Aviso creado.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Announcement' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   */
  router.post(
    '/:communityId/announcements',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('PRESIDENT', 'ADMIN'),
    controller.createAnnouncement,
  )

  return router
}

/**
 * Rutas con el aviso en la URL.
 *
 * `requireAnnouncement()` sustituye a `requireCommunity()` en las dos: resuelve
 * la comunidad del aviso con `app_announcement_community()` y la deja en
 * `req.community`, con lo que el servicio funcionaria igual que en el resto del
 * proyecto.
 *
 * Ninguna de las dos lleva `requireCommunityRole`, ni siquiera el PUT: el rol
 * lo decide la funcion con la fila delante, por el argumento 2 de la cabecera.
 */
export function createAnnouncementRouter(): Router {
  const router = Router()

  /**
   * @swagger
   * /api/v1/announcements/{id}:
   *   put:
   *     summary: Actualizar un aviso
   *     description: |
   *       Requiere rol PRESIDENT o ADMIN sobre la comunidad del aviso, o ser
   *       su autor. La comprobación la hace `app_update_announcement()` dentro
   *       de la transacción, con la fila delante.
   *     tags: [Announcements]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               title: { type: string, minLength: 1, maxLength: 200 }
   *               body: { type: string }
   *               type: { $ref: '#/components/schemas/AnnouncementType' }
   *               priority: { $ref: '#/components/schemas/AnnouncementPriority' }
   *               isPinned: { type: boolean }
   *               minRole: { type: string, enum: [NEIGHBOR, PRESIDENT, ADMIN] }
   *               publishAt: { type: string, format: date-time, nullable: true }
   *               expiresAt: { type: string, format: date-time, nullable: true }
   *     responses:
   *       200:
   *         description: Aviso actualizado.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Announcement' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.put(
    '/announcements/:id',
    requireAuth,
    requireAnnouncement(),
    controller.updateAnnouncement,
  )

  /**
   * @swagger
   * /api/v1/announcements/{id}:
   *   delete:
   *     summary: Eliminar un aviso (soft delete)
   *     description: |
   *       Requiere rol ADMIN. El 403 lo emite `app_delete_announcement()` con
   *       `announcement_requires_admin` — el único sitio donde se decide.
   *     tags: [Announcements]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       204:
   *         description: Aviso eliminado.
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.delete(
    '/announcements/:id',
    requireAuth,
    requireAnnouncement(),
    controller.deleteAnnouncement,
  )

  return router
}
