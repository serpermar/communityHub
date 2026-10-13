// ---------------------------------------------------------------------------
// Servicio de finanzas.
//
// La autorizacion esta en las funciones de SQL (02j), igual que en el resto de
// bloques: pertenencia, rol ADMIN y borrados viven DENTRO de la transaccion, en
// el unico sitio donde el motor las ve. Aqui no hay ningun `if (rol === ...)`:
// seria una segunda copia de una regla que ya esta escrita y probada en SQL.
//
// Lo propio de este bloque:
//
//   - TODA lectura de gastos pasa por `app_list_expenses()` y TODA lectura de
//     facturas por `app_list_invoices()` (FN-3): el listado y el detalle por id
//     comparten consulta, para que no haya dos copias de la visibilidad que
//     puedan discrepar.
//   - El mapeo de `numeric` a numero es obligatorio (FN-9): `$queryRaw` devuelve
//     `amount` como string, y un "890.25" en el JSON del contrato seria un bug
//     de serializacion, no un detalle.
//   - El detalle por id, la edicion, el borrado y el pago de un gasto no llevan
//     comunidad en la URL: van con `communityId: null` y la funcion decide la
//     visibilidad. Las rutas de comunidad si la llevan y se pasa tal cual.
// ---------------------------------------------------------------------------

import { withContext } from '../context.js'
import { notFound } from '../http/errors.js'
import * as repo from './repository.js'
import { ejecuta } from './errors.js'
import type { CreateInvoiceInput, ExpenseInput, ExpensesQueryInput, InvoicesQueryInput } from './validators.js'

/** El gasto tal como sale en la API (spec 09 §7.4). */
export type ExpenseView = {
  id: string
  communityId: string
  concept: string
  category: string
  amount: number
  expenseDate: string
  supplier: string | null
  notes: string | null
  invoiceId: string | null
  invoiceNumber: string | null
  createdBy: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
}

/** La factura tal como sale en la API: `status` (guardado) y `effectiveStatus` (derivado, FN-5). */
export type InvoiceView = {
  id: string
  communityId: string
  number: string
  concept: string | null
  amount: number
  issueDate: string
  dueDate: string
  paidAt: string | null
  status: string
  effectiveStatus: string
  supplier: string | null
  isGenerated: boolean
  createdBy: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
}

/** El resumen economico (spec 09 §7.4). */
export type FinanceSummaryView = {
  expenseTotal: number
  expenseCount: number
  expenseByCategory: Array<{ category: string; total: number; count: number }>
  expenseRecent: Array<{ id: string; concept: string; category: string; amount: number; expenseDate: string; supplier: string | null }>
  invoiceTotal: number
  invoiceCount: number
  invoiceOpenAmount: number
  invoicePaidAmount: number
  invoicePendingCount: number
  invoiceOverdueCount: number
}

export type Paged<T> = {
  items: T[]
  meta: { page: number; limit: number; total: number; totalPages: number }
}

/**
 * Una fecha `date` (sin hora) al `YYYY-MM-DD` del contrato.
 *
 * El driver puede devolverla como `Date` (a medianoche UTC, en cuyo caso
 * `toISOString()` es el mismo dia) o como cadena `YYYY-MM-DD`. Se aceptan las
 * dos para no depender de una version concreta del cliente.
 */
function aFecha(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'string') return value.slice(0, 10)
  return String(value)
}

/** Un instante (`timestamptz`) a ISO 8601 UTC, como en el resto de modulos. */
function aInstante(value: Date): string {
  return value.toISOString()
}

/** `numeric` de `$queryRaw` a numero (FN-9). */
function aNumero(value: string): number {
  return Number(value)
}

function gastoAVista(row: repo.ExpenseRow): ExpenseView {
  return {
    id: row.id,
    communityId: row.community_id,
    concept: row.concept,
    category: row.category,
    amount: aNumero(row.amount),
    expenseDate: aFecha(row.expense_date),
    supplier: row.supplier,
    notes: row.notes,
    invoiceId: row.invoice_id,
    invoiceNumber: row.invoice_number,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: aInstante(row.created_at),
    updatedAt: aInstante(row.updated_at),
  }
}

function facturaAVista(row: repo.InvoiceRow): InvoiceView {
  return {
    id: row.id,
    communityId: row.community_id,
    number: row.number,
    concept: row.concept,
    amount: aNumero(row.amount),
    issueDate: aFecha(row.issue_date),
    dueDate: aFecha(row.due_date),
    paidAt: row.paid_at ? aInstante(row.paid_at) : null,
    status: row.status,
    effectiveStatus: row.effective_status,
    supplier: row.supplier,
    isGenerated: row.is_generated,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: aInstante(row.created_at),
    updatedAt: aInstante(row.updated_at),
  }
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/** Listar los gastos de una comunidad (FN-4: el no-ADMIN recibe 403 DENTRO de la funcion). */
export async function listExpenses(
  userId: string,
  communityId: string,
  query: ExpensesQueryInput,
): Promise<Paged<ExpenseView>> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const page = query.page ?? 1
      const limit = query.limit ?? 20
      const offset = (page - 1) * limit

      const filtros = {
        category: query.category,
        from: query.from,
        to: query.to,
        limit,
        offset,
      }

      const rows = await repo.listExpenses(tx, communityId, filtros)

      let total = 0
      const primera = rows[0]

      if (primera) {
        total = Number(primera.total_count)
      } else if (offset > 0) {
        const muestra = await repo.listExpenses(tx, communityId, { ...filtros, limit: 1, offset: 0 })
        const primeraMuestra = muestra[0]
        total = primeraMuestra ? Number(primeraMuestra.total_count) : 0
      }

      return {
        items: rows.map(gastoAVista),
        meta: { page, limit, total, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
      }
    }),
  )
}

/** Un gasto por id (GET /expenses/:id). Sin `requireCommunity`: cero filas o no-ADMIN -> 404 (FN-4). */
export async function getExpense(userId: string, expenseId: string): Promise<ExpenseView> {
  return ejecuta(() =>
    withContext({ userId, communityId: null }, async (tx) => {
      const row = await repo.findExpense(tx, expenseId)

      if (!row) {
        throw notFound('Ese gasto no existe o no es visible.')
      }

      return gastoAVista(row)
    }),
  )
}

/** Listar las facturas de una comunidad. `?status=OVERDUE` filtra por estado efectivo (FN-14). */
export async function listInvoices(
  userId: string,
  communityId: string,
  query: InvoicesQueryInput,
): Promise<Paged<InvoiceView>> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const page = query.page ?? 1
      const limit = query.limit ?? 20
      const offset = (page - 1) * limit

      const filtros = { status: query.status, limit, offset }

      const rows = await repo.listInvoices(tx, communityId, filtros)

      let total = 0
      const primera = rows[0]

      if (primera) {
        total = Number(primera.total_count)
      } else if (offset > 0) {
        const muestra = await repo.listInvoices(tx, communityId, { ...filtros, limit: 1, offset: 0 })
        const primeraMuestra = muestra[0]
        total = primeraMuestra ? Number(primeraMuestra.total_count) : 0
      }

      return {
        items: rows.map(facturaAVista),
        meta: { page, limit, total, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
      }
    }),
  )
}

/** El resumen economico (spec 09 §5.10). La funcion garantiza UNA fila (D-2). */
export async function financeSummary(userId: string, communityId: string): Promise<FinanceSummaryView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const row = await repo.financeSummary(tx, communityId)

      if (!row) {
        throw new Error('app_finance_summary() no devolvió la fila garantizada')
      }

      return {
        expenseTotal: aNumero(row.expense_total),
        expenseCount: Number(row.expense_count),
        expenseByCategory: row.expense_by_category,
        expenseRecent: row.expense_recent,
        invoiceTotal: aNumero(row.invoice_total),
        invoiceCount: Number(row.invoice_count),
        invoiceOpenAmount: aNumero(row.invoice_open_amount),
        invoicePaidAmount: aNumero(row.invoice_paid_amount),
        invoicePendingCount: Number(row.invoice_pending_count),
        invoiceOverdueCount: Number(row.invoice_overdue_count),
      }
    }),
  )
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

/**
 * Alta de un gasto (solo ADMIN; el guard de ruta y la funcion lo repiten).
 *
 * La respuesta sale de una RELECTURA con `findExpense()` (dentro de la misma
 * transaccion), no de los parametros de entrada: solo asi lo que devuelve la
 * API es exactamente lo que quedo escrito, con los `btrim`/`nullif` de la
 * funcion ya aplicados.
 */
export async function createExpense(
  userId: string,
  communityId: string,
  input: ExpenseInput,
): Promise<ExpenseView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const id = await repo.createExpense(tx, communityId, {
        concept: input.concept,
        category: input.category,
        amount: input.amount,
        expenseDate: input.expenseDate,
        supplier: input.supplier,
        invoiceId: input.invoiceId,
        notes: input.notes,
      })

      const row = await repo.findExpense(tx, id)

      if (!row) {
        throw new Error('El gasto se creó pero no se puede leer.')
      }

      return gastoAVista(row)
    }),
  )
}

/**
 * Edicion de un gasto (PUT, reemplazo completo, FN-7). Sin comunidad en la URL:
 * `app_update_expense()` decide el 404 y el 403. Relectura como en el alta.
 */
export async function updateExpense(
  userId: string,
  expenseId: string,
  input: ExpenseInput,
): Promise<ExpenseView> {
  return ejecuta(() =>
    withContext({ userId, communityId: null }, async (tx) => {
      await repo.updateExpense(tx, expenseId, {
        concept: input.concept,
        category: input.category,
        amount: input.amount,
        expenseDate: input.expenseDate,
        supplier: input.supplier,
        invoiceId: input.invoiceId,
        notes: input.notes,
      })

      const row = await repo.findExpense(tx, expenseId)

      if (!row) {
        throw new Error('El gasto se actualizó pero no se puede leer.')
      }

      return gastoAVista(row)
    }),
  )
}

/** Borrado de un gasto (soft delete, FN-8). Solo ADMIN lo decide la funcion. */
export async function deleteExpense(userId: string, expenseId: string): Promise<void> {
  return ejecuta(() =>
    withContext({ userId, communityId: null }, async (tx) => {
      await repo.deleteExpense(tx, expenseId)
    }),
  )
}

/**
 * Alta de una factura (solo ADMIN). El 409 por numero repetido lo decide
 * `app_create_invoice()` (FN-12). Relectura con `findInvoice()` para la respuesta.
 */
export async function createInvoice(
  userId: string,
  communityId: string,
  input: CreateInvoiceInput,
): Promise<InvoiceView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const id = await repo.createInvoice(tx, communityId, {
        number: input.number,
        concept: input.concept,
        amount: input.amount,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        supplier: input.supplier,
      })

      const row = await repo.findInvoice(tx, id)

      if (!row) {
        throw new Error('La factura se creó pero no se puede leer.')
      }

      return facturaAVista(row)
    }),
  )
}

/**
 * Pagar una factura (FN-6). El segundo pago es un 409 INVOICE_ALREADY_PAID, no
 * un 200 idempotente, y lo levanta la funcion. La relectura trae el estado
 * post-pago (PAID + paidAt).
 */
export async function payInvoice(userId: string, communityId: string, invoiceId: string): Promise<InvoiceView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      await repo.payInvoice(tx, invoiceId)

      const row = await repo.findInvoice(tx, invoiceId)

      if (!row) {
        throw new Error('La factura se pagó pero no se puede leer.')
      }

      return facturaAVista(row)
    }),
  )
}