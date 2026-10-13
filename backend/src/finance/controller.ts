// ---------------------------------------------------------------------------
// Controller de finanzas.
//
// Reparte HTTP y valida la FORMA de lo que llega; no decide negocio. Toda la
// autorizacion esta en las funciones de SQL (02j), con el chequeo grueso de
// ADMIN para las rutas de comunidad en el router.
//
// Detalles propios del bloque:
//
//   - El alta de gasto responde 201 con `Location: /api/v1/expenses/{id}`
//     (spec 09 §7.4), porque la API SI expone `GET /expenses/:id`.
//   - El alta de factura responde 201 SIN `Location`: no existe
//     `GET /invoices/:id` (FN-13), y un Location a una ruta inexistente seria
//     mentir.
//   - El borrado de gasto responde 200 con `{ id, deleted: true }`, como
//     avisos/documentos. El segundo borrado es 404, no un 200 idempotente.
//   - `pay` no lleva cuerpo: el guard `.strict()` de un objeto vacio rechaza
//     cualquier campo.
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express'
import { badRequest } from '../http/errors.js'
import { created, ok } from '../http/envelope.js'
import { formatIssues } from '../auth/validators.js'
import type { ZodType } from 'zod'
import { routeParam } from '../auth/middleware.js'
import * as service from './service.js'
import {
  createInvoiceSchema,
  expenseSchema,
  expensesQuerySchema,
  invoicesQuerySchema,
  payBodySchema,
  uuidSchema,
} from './validators.js'

function parse<T>(schema: ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload)

  if (!result.success) {
    throw badRequest('Los datos enviados no son válidos.', formatIssues(result.error))
  }

  return result.data
}

/** Un UUID de ruta, o un 400 que lo diga (C-9). */
function uuidParam(req: Request, name: string): string {
  return parse(uuidSchema, routeParam(req, name))
}

/** Para las rutas con comunidad en la URL: `req.community` ya lo puso el middleware. */
function comunidadDeRuta(req: Request): { userId: string; communityId: string } {
  if (!req.auth) {
    throw badRequest('Petición sin sesión.')
  }

  if (!req.community) {
    throw badRequest('Petición sin contexto de comunidad.')
  }

  return { userId: req.auth.userId, communityId: req.community.communityId }
}

/** Para las rutas con el gasto en la URL: solo hace falta quién pide. */
function actor(req: Request): string {
  if (!req.auth) {
    throw badRequest('Petición sin sesión.')
  }

  return req.auth.userId
}

// ---------------------------------------------------------------------------
// Rutas con :communityId en la URL
// ---------------------------------------------------------------------------

/** `GET /communities/:communityId/expenses?from=&to=&category=&page=&limit=` */
export async function listExpenses(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = comunidadDeRuta(req)
    const query = parse(expensesQuerySchema, req.query)

    const resultado = await service.listExpenses(userId, communityId, query)

    ok(res, resultado.items, resultado.meta)
  } catch (error) {
    next(error)
  }
}

/**
 * `POST /communities/:communityId/expenses` (solo ADMIN).
 *
 * El rol ADMIN lo pone `requireCommunityRole('ADMIN')` en la ruta (chequeo
 * grueso) y lo repite `app_create_expense()` dentro de la transaccion. El 201
 * lleva `Location` con el gasto recien creado.
 */
export async function createExpense(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = comunidadDeRuta(req)
    const input = parse(expenseSchema, req.body)

    const gasto = await service.createExpense(userId, communityId, input)

    res.location(`/api/v1/expenses/${gasto.id}`)
    created(res, gasto)
  } catch (error) {
    next(error)
  }
}

/** `GET /communities/:communityId/invoices?status=&page=&limit=` */
export async function listInvoices(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = comunidadDeRuta(req)
    const query = parse(invoicesQuerySchema, req.query)

    const resultado = await service.listInvoices(userId, communityId, query)

    ok(res, resultado.items, resultado.meta)
  } catch (error) {
    next(error)
  }
}

/**
 * `POST /communities/:communityId/invoices` (solo ADMIN).
 *
 * El 201 NO lleva `Location` (FN-13): no hay `GET /invoices/:id`. El 409 por
 * numero repetido lo levanta `app_create_invoice()` con `invoice_number_taken`.
 */
export async function createInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = comunidadDeRuta(req)
    const input = parse(createInvoiceSchema, req.body)

    const factura = await service.createInvoice(userId, communityId, input)

    created(res, factura)
  } catch (error) {
    next(error)
  }
}

/**
 * `POST /communities/:communityId/invoices/:invoiceId/pay`.
 *
 * Sin cuerpo. El segundo pago es un 409 `INVOICE_ALREADY_PAID` (FN-6), no un
 * 200 idempotente. La `communityId` de la URL valida la membresia en el
 * middleware; la funcion resuelve la factura por su fila.
 */
export async function payInvoice(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = comunidadDeRuta(req)
    const invoiceId = uuidParam(req, 'invoiceId')

    parse(payBodySchema, req.body ?? {})

    ok(res, await service.payInvoice(userId, communityId, invoiceId))
  } catch (error) {
    next(error)
  }
}

/** `GET /communities/:communityId/finance/summary` (solo ADMIN, sin query). */
export async function financeSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = comunidadDeRuta(req)

    ok(res, await service.financeSummary(userId, communityId))
  } catch (error) {
    next(error)
  }
}

// ---------------------------------------------------------------------------
// Rutas con :id de gasto
// ---------------------------------------------------------------------------

/**
 * `GET /expenses/:id`.
 *
 * Sin comunidad en la URL: `app_list_expenses()` con `p_expense` decide la
 * visibilidad. Cero filas -> 404 unico (no existe / otra comunidad / borrado /
 * no eres ADMIN), por C-8 y FN-4.
 */
export async function getExpense(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = actor(req)
    const expenseId = uuidParam(req, 'id')

    ok(res, await service.getExpense(userId, expenseId))
  } catch (error) {
    next(error)
  }
}

/**
 * `PUT /expenses/:id` (reemplazo completo, FN-7).
 *
 * Sin guard de rol en la ruta: `app_update_expense()` decide el 404
 * (`expense_not_found`) y el 403 (`expense_requires_admin`).
 */
export async function updateExpense(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = actor(req)
    const expenseId = uuidParam(req, 'id')
    const input = parse(expenseSchema, req.body)

    ok(res, await service.updateExpense(userId, expenseId, input))
  } catch (error) {
    next(error)
  }
}

/**
 * `DELETE /expenses/:id` (soft delete, FN-8).
 *
 * 200 con `{ id, deleted: true }`. El rol (solo ADMIN) lo decide
 * `app_delete_expense()`; el segundo borrado es 404, no un 200 idempotente.
 */
export async function deleteExpense(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = actor(req)
    const expenseId = uuidParam(req, 'id')

    await service.deleteExpense(userId, expenseId)

    ok(res, { id: expenseId, deleted: true })
  } catch (error) {
    next(error)
  }
}