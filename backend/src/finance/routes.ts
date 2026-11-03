// (cabecera original sin cambios)

import { Router } from 'express'
import { requireAuth, requireCommunity, requireCommunityRole } from '../auth/middleware.js'
import * as controller from './controller.js'

export function createFinanceRouter(): Router {
  const router = Router()

  /**
   * @swagger
   * /api/v1/communities/{communityId}/expenses:
   *   get:
   *     summary: Listar gastos
   *     description: Requiere rol ADMIN.
   *     tags: [Finance]
   *     parameters:
   *       - in: path
   *         name: communityId
   *         required: true
   *         schema: { type: string, format: uuid }
   *       - in: query
   *         name: status
   *         schema: { $ref: '#/components/schemas/ExpenseStatus' }
   *       - in: query
   *         name: page
   *         schema: { type: integer, minimum: 1, default: 1 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
   *     responses:
   *       200:
   *         description: Lista paginada de gastos.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/ExpenseListResponse' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   */
  router.get(
    '/:communityId/expenses',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('ADMIN'),
    controller.listExpenses,
  )

  /**
   * @swagger
   * /api/v1/communities/{communityId}/expenses:
   *   post:
   *     summary: Crear un gasto
   *     description: Requiere rol ADMIN.
   *     tags: [Finance]
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
   *             required: [concept, category, amount, expenseDate]
   *             properties:
   *               concept: { type: string, minLength: 1, maxLength: 200 }
   *               category: { $ref: '#/components/schemas/ExpenseCategory' }
   *               amount: { type: number, format: float, minimum: 0.01 }
   *               expenseDate: { type: string, format: date }
   *               supplier: { type: string, nullable: true }
   *               notes: { type: string, nullable: true }
   *               invoiceId: { type: string, format: uuid, nullable: true }
   *     responses:
   *       201:
   *         description: Gasto creado.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Expense' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   */
  router.post(
    '/:communityId/expenses',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('ADMIN'),
    controller.createExpense,
  )

  /**
   * @swagger
   * /api/v1/communities/{communityId}/invoices:
   *   get:
   *     summary: Listar facturas
   *     description: Requiere rol ADMIN.
   *     tags: [Finance]
   *     parameters:
   *       - in: path
   *         name: communityId
   *         required: true
   *         schema: { type: string, format: uuid }
   *       - in: query
   *         name: status
   *         schema: { $ref: '#/components/schemas/InvoiceStatus' }
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 1 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 20 }
   *     responses:
   *       200:
   *         description: Lista paginada de facturas.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/InvoiceListResponse' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   */
  router.get(
    '/:communityId/invoices',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('ADMIN'),
    controller.listInvoices,
  )

  /**
   * @swagger
   * /api/v1/communities/{communityId}/invoices:
   *   post:
   *     summary: Crear una factura
   *     description: Requiere rol ADMIN.
   *     tags: [Finance]
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
   *             required: [number, concept, amount, issueDate]
   *             properties:
   *               number: { type: string }
   *               concept: { type: string }
   *               amount: { type: number, format: float }
   *               issueDate: { type: string, format: date }
   *               dueDate: { type: string, format: date, nullable: true }
   *               supplier: { type: string, nullable: true }
   *     responses:
   *       201:
   *         description: Factura creada.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Invoice' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   */
  router.post(
    '/:communityId/invoices',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('ADMIN'),
    controller.createInvoice,
  )

  /**
   * @swagger
   * /api/v1/communities/{communityId}/invoices/{invoiceId}/pay:
   *   post:
   *     summary: Marcar una factura como pagada
   *     description: Requiere rol ADMIN.
   *     tags: [Finance]
   *     parameters:
   *       - in: path
   *         name: communityId
   *         required: true
   *         schema: { type: string, format: uuid }
   *       - in: path
   *         name: invoiceId
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200:
   *         description: Factura pagada.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Invoice' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       404: { $ref: '#/components/responses/NotFound' }
   *       409: { $ref: '#/components/responses/Conflict' }
   */
  router.post(
    '/:communityId/invoices/:invoiceId/pay',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('ADMIN'),
    controller.payInvoice,
  )

  /**
   * @swagger
   * /api/v1/communities/{communityId}/finance/summary:
   *   get:
   *     summary: Resumen financiero de la comunidad
   *     description: Requiere rol ADMIN. Agrega ingresos, gastos, balance y facturas pendientes.
   *     tags: [Finance]
   *     parameters:
   *       - in: path
   *         name: communityId
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200:
   *         description: Resumen financiero.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/FinanceSummary' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   */
  router.get(
    '/:communityId/finance/summary',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('ADMIN'),
    controller.financeSummary,
  )

  return router
}

export function createExpenseRouter(): Router {
  const router = Router()

  /**
   * @swagger
   * /api/v1/expenses/{id}:
   *   get:
   *     summary: Detalle de un gasto
   *     description: |
   *       La visibilidad (404 si no es ADMIN de la comunidad del gasto) la
   *       decide la función de lectura dentro de la transacción.
   *     tags: [Finance]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       200:
   *         description: Gasto.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Expense' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.get('/expenses/:id', requireAuth, controller.getExpense)

  /**
   * @swagger
   * /api/v1/expenses/{id}:
   *   put:
   *     summary: Actualizar un gasto
   *     description: El rol se comprueba dentro de la transacción.
   *     tags: [Finance]
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
   *               concept: { type: string }
   *               category: { $ref: '#/components/schemas/ExpenseCategory' }
   *               amount: { type: number, format: float }
   *               expenseDate: { type: string, format: date }
   *               supplier: { type: string, nullable: true }
   *               notes: { type: string, nullable: true }
   *     responses:
   *       200:
   *         description: Gasto actualizado.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/Expense' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.put('/expenses/:id', requireAuth, controller.updateExpense)

  /**
   * @swagger
   * /api/v1/expenses/{id}:
   *   delete:
   *     summary: Eliminar un gasto
   *     description: El rol se comprueba dentro de la transacción.
   *     tags: [Finance]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       204:
   *         description: Gasto eliminado.
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   *       404: { $ref: '#/components/responses/NotFound' }
   */
  router.delete('/expenses/:id', requireAuth, controller.deleteExpense)

  return router
}
