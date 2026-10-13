// ---------------------------------------------------------------------------
// Rutas de finanzas.
//
// En DOS routers por la misma razon que los bloques 05-08: las rutas de
// comunidad cuelgan de `/api/v1/communities` y las de gasto por id de
// `/api/v1`. El orden de los middleware ES la autorizacion:
//
//   GET    /communities/:communityId/expenses                 requireAuth + requireCommunity() + ADMIN
//   POST   /communities/:communityId/expenses                 idem
//   GET    /communities/:communityId/invoices                 idem
//   POST   /communities/:communityId/invoices                 idem
//   POST   /communities/:communityId/invoices/:invoiceId/pay  idem
//   GET    /communities/:communityId/finance/summary          idem
//   GET    /expenses/:id                                      requireAuth
//   PUT    /expenses/:id                                      requireAuth
//   DELETE /expenses/:id                                      requireAuth
//
// Tres decisiones, ninguna nueva (spec 09 §7.2):
//
//   1. Las rutas por id de gasto NO llevan `requireCommunity()` (no hay
//      `:communityId` en la URL) ni un guard de rol: la visibilidad y el rol
//      los decide la funcion de SQL dentro de la transaccion. El detalle da
//      404 a un no-ADMIN (C-8, FN-4), no 403.
//
//   2. Las rutas de comunidad SI llevan `requireCommunityRole('ADMIN')` como
//      chequeo grueso (FN-1), colocado antes de tocar PostgreSQL: un NEIGHBOR
//      recibe el 403 sin abrir transaccion. La funcion lo repite dentro.
//
//   3. La asimetria de facturas es deliberada: no hay `GET /invoices/:id` ni
//      `PUT`/`DELETE` de facturas (FN-8/FN-13); las tres rutas de factura
//      cuelgan de la comunidad.
// ---------------------------------------------------------------------------

import { Router } from 'express'
import { requireAuth, requireCommunity, requireCommunityRole } from '../auth/middleware.js'
import * as controller from './controller.js'

/**
 * Rutas con la comunidad en la URL. Las seis son ADMIN (FN-1): el bloque
 * entero es solo de administradores, listar incluido (el listado confirma que
 * hay datos, FN-4).
 */
export function createFinanceRouter(): Router {
  const router = Router()

  router.get('/:communityId/expenses', requireAuth, requireCommunity(), requireCommunityRole('ADMIN'), controller.listExpenses)
  router.post('/:communityId/expenses', requireAuth, requireCommunity(), requireCommunityRole('ADMIN'), controller.createExpense)

  router.get('/:communityId/invoices', requireAuth, requireCommunity(), requireCommunityRole('ADMIN'), controller.listInvoices)
  router.post('/:communityId/invoices', requireAuth, requireCommunity(), requireCommunityRole('ADMIN'), controller.createInvoice)
  router.post(
    '/:communityId/invoices/:invoiceId/pay',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('ADMIN'),
    controller.payInvoice,
  )

  router.get('/:communityId/finance/summary', requireAuth, requireCommunity(), requireCommunityRole('ADMIN'), controller.financeSummary)

  return router
}

/** Rutas con el gasto en la URL. Ninguna lleva guard de rol: decidirlo fuera de la transaccion seria duplicar la regla (FN-4). */
export function createExpenseRouter(): Router {
  const router = Router()

  router.get('/expenses/:id', requireAuth, controller.getExpense)
  router.put('/expenses/:id', requireAuth, controller.updateExpense)
  router.delete('/expenses/:id', requireAuth, controller.deleteExpense)

  return router
}