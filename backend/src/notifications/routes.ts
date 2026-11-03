// (cabecera original sin cambios)

import { Router } from 'express'
import { requireAuth } from '../auth/middleware.js'
import * as controller from './controller.js'

export function createNotificationsRouter(): Router {
  const router = Router()

  /**
   * @swagger
   * /api/v1/notifications:
   *   get:
   *     summary: Listar notificaciones del usuario
   *     description: Lista global por usuario (no por comunidad). RLS `notifications_own`.
   *     tags: [Notifications]
   *     parameters:
   *       - in: query
   *         name: unread
   *         schema: { type: boolean }
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 1 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 20 }
   *     responses:
   *       200:
   *         description: Lista paginada de notificaciones.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/NotificationListResponse' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   */
  router.get('/', requireAuth, controller.list)

  /**
   * @swagger
   * /api/v1/notifications/unread-count:
   *   get:
   *     summary: Contar notificaciones no leídas
   *     tags: [Notifications]
   *     responses:
   *       200:
   *         description: Número de no leídas.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/UnreadCountResponse' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   */
  router.get('/unread-count', requireAuth, controller.unreadCount)

  /**
   * @swagger
   * /api/v1/notifications/{id}/read:
   *   patch:
   *     summary: Marcar una notificación como leída
   *     tags: [Notifications]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       204:
   *         description: Notificación marcada como leída.
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.patch('/:id/read', requireAuth, controller.markRead)

  /**
   * @swagger
   * /api/v1/notifications/read-all:
   *   post:
   *     summary: Marcar todas las notificaciones como leídas
   *     tags: [Notifications]
   *     responses:
   *       204:
   *         description: Todas marcadas como leídas.
   *       401: { $ref: '#/components/responses/Unauthorized' }
   */
  router.post('/read-all', requireAuth, controller.readAll)

  return router
}
