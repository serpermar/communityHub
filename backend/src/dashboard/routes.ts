// (cabecera original sin cambios)

import { Router } from 'express'
import { requireAuth, requireCommunity } from '../auth/middleware.js'
import * as controller from './controller.js'

export function createDashboardRouter(): Router {
  const router = Router()

  /**
   * @swagger
   * /api/v1/communities/{communityId}/dashboard:
   *   get:
   *     summary: Resumen de la home de la comunidad
   *     description: |
   *       Cualquier miembro activo. Los campos financieros (`pendingInvoices`,
   *       `balanceCents`) solo se devuelven a ADMIN (DSH-3).
   *     tags: [Dashboard]
   *     parameters:
   *       - in: path
   *         name: communityId
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200:
   *         description: Resumen.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/DashboardSummary' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   */
  router.get('/:communityId/dashboard', requireAuth, requireCommunity(), controller.getDashboard)

  return router
}
