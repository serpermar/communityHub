// ---------------------------------------------------------------------------
// Acceso a datos de finanzas.
//
// Es el unico sitio del modulo que escribe SQL. Todas las funciones reciben el
// cliente de transaccion, nunca el singleton: por construccion no se puede leer
// nada fuera del contexto de RLS.
//
// Todo va por SQL a mano y no es mania:
//
//   - `app_runtime` no tiene INSERT/UPDATE/DELETE sobre `invoices` ni sobre
//     `expenses` (02j_FINANCE.sql secciones 7-8 revocan y eliminan las
//     politicas de escritura), asi que el cliente de Prisma no puede escribir
//     en ninguna de las dos tablas.
//   - El 403/404 de finanzas solo existe DENTRO de las funciones
//     SECURITY DEFINER de 02j (FN-1, FN-4): un `select * from expenses` del
//     backend saltaria el perimetro y un `app_list_expenses` es la unica
//     lectura que respeta el ADMIN-unico.
//   - `created_by_name` y `invoice_number` solo existen dentro de
//     `app_list_expenses()` / `app_list_invoices()` (LEFT JOINs que las
//     politicas no dejan hacer desde el cliente).
//
// Ninguna consulta lleva un valor del cliente dentro de un `Prisma.raw`: los
// nombres de columna van LITERALMENTE en la plantilla, porque en `$queryRaw`
// cualquier cosa metida en `${}` viaja como parametro ligado, no como SQL.
// ---------------------------------------------------------------------------

import { type Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

/**
 * Una fila de lectura de gasto, tal como la devuelve `app_list_expenses()`.
 *
 * Los nombres van en `snake_case` porque son los de los `returns table`. El
 * `service.ts` es quien los traduce a camelCase.
 *
 * `category` llega como cadena (ENUM, Prisma no lo tiene tipado para una
 * consulta en crudo). `amount` llega como cadena porque el tipo de Postgres es
 * `numeric`. `total_count` viene de `count(*) over ()`, repetido en cada fila.
 */
export type ExpenseRow = {
  id: string
  community_id: string
  concept: string
  category: string
  amount: string
  expense_date: Date
  supplier: string | null
  notes: string | null
  invoice_id: string | null
  invoice_number: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: Date
  updated_at: Date
  total_count: bigint
}

/**
 * Una fila de lectura de factura, tal como la devuelve `app_list_invoices()`.
 *
 * `status` es el guardado y `effective_status` el derivado (FN-5): la API
 * expone los dos (spec 09 §7.4).
 */
export type InvoiceRow = {
  id: string
  community_id: string
  number: string
  concept: string | null
  amount: string
  issue_date: Date
  due_date: Date
  paid_at: Date | null
  status: string
  effective_status: string
  supplier: string | null
  is_generated: boolean
  created_by: string | null
  created_by_name: string | null
  created_at: Date
  updated_at: Date
  total_count: bigint
}

/** La fila unica del resumen (spec 09 §5.10, D-2). */
export type SummaryRow = {
  expense_total: string
  expense_count: bigint
  expense_by_category: Array<{ category: string; total: number; count: number }>
  expense_recent: Array<{
    id: string
    concept: string
    category: string
    amount: number
    expenseDate: string
    supplier: string | null
  }>
  invoice_total: string
  invoice_count: bigint
  invoice_open_amount: string
  invoice_paid_amount: string
  invoice_pending_count: bigint
  invoice_overdue_count: bigint
}

/**
 * Filtros del listado, ya validados por zod.
 *
 * `limit` y `offset` van SIEMPRE escritos (no los defaults de la funcion): el
 * calculo `offset = (page - 1) * limit` es del servicio, y si la funcion
 * aplicara otros defaults el segundo pedazo de pagina saldria de mas.
 */
export type FiltrosExpenses = {
  expense?: string
  category?: string
  from?: string
  to?: string
  limit: number
  offset: number
}

export type FiltrosInvoices = {
  invoice?: string
  status?: string
  limit: number
  offset: number
}

/**
 * Listar los gastos de una comunidad, o buscar uno por id (FN-3: misma
 * funcion, mismo predicado).
 *
 * Toda la autorizacion esta dentro de la funcion: pertenencia, rol ADMIN y
 * borrados. Aqui no hay ningun filtro de rol, y no por descuido:
 * reimplementarlo en TypeScript seria una segunda copia de una regla que ya
 * esta escrita y probada en 02j.
 *
 * `communityId` es null en el detalle por id (GET /expenses/:id no lleva la
 * comunidad en la URL): el predicado usa la fila, y la funcion hace el 404.
 */
export async function listExpenses(
  tx: Tx,
  communityId: string | null,
  filtros: FiltrosExpenses,
): Promise<ExpenseRow[]> {
  return tx.$queryRaw<ExpenseRow[]>`
    select
      id, community_id, concept, category, amount, expense_date,
      supplier, notes, invoice_id, invoice_number,
      created_by, created_by_name, created_at, updated_at, total_count
      from app_list_expenses(
        ${communityId}::uuid,
        ${filtros.expense ?? null}::uuid,
        ${filtros.category ?? null}::expense_category,
        ${filtros.from ?? null}::date,
        ${filtros.to ?? null}::date,
        ${filtros.limit}::integer,
        ${filtros.offset}::integer
      )
  `
}

/**
 * Listar las facturas de una comunidad o buscar una por id (FN-3).
 *
 * `status=OVERDUE` es legitimo aqui: la funcion compara con el ESTADO EFECTIVO
 * (FN-14), de modo que el filtro devuelve las vencidas sin que exista la fila
 * 'OVERDUE' en la tabla.
 */
export async function listInvoices(
  tx: Tx,
  communityId: string | null,
  filtros: FiltrosInvoices,
): Promise<InvoiceRow[]> {
  return tx.$queryRaw<InvoiceRow[]>`
    select
      id, community_id, number, concept, amount, issue_date, due_date,
      paid_at, status, effective_status, supplier, is_generated,
      created_by, created_by_name, created_at, updated_at, total_count
      from app_list_invoices(
        ${communityId}::uuid,
        ${filtros.invoice ?? null}::uuid,
        ${filtros.status ?? null}::invoice_status,
        ${filtros.limit}::integer,
        ${filtros.offset}::integer
      )
  `
}

/** Un gasto concreto, o null si no existe o no es visible (FN-4: cero filas -> 404). */
export async function findExpense(tx: Tx, expenseId: string): Promise<ExpenseRow | null> {
  const rows = await listExpenses(tx, null, { expense: expenseId, limit: 1, offset: 0 })
  return rows[0] ?? null
}

/** Una factura concreta, o null si no existe o no es visible. Relectura por el MISMO listado (FN-3). */
export async function findInvoice(tx: Tx, invoiceId: string): Promise<InvoiceRow | null> {
  const rows = await listInvoices(tx, null, { invoice: invoiceId, limit: 1, offset: 0 })
  return rows[0] ?? null
}

/**
 * Crear un gasto y devolver su id.
 *
 * `$queryRaw` y no `$executeRaw` porque la funcion devuelve `uuid`. `createdBy`
 * no viaja (FN-1): lo escribe la funcion con `app_current_user_id()`. Los
 * campos ausentes del POST los decide la funcion con los mismos `coalesce` /
 * `nullif` que el alta, para que "no lo mandaste" y "lo mandaste vacio" acaben
 * en el mismo sitio.
 */
export async function createExpense(
  tx: Tx,
  communityId: string,
  input: {
    concept: string
    category?: string
    amount: number
    expenseDate: string
    supplier: string | null
    invoiceId: string | null
    notes: string | null
  },
): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    select app_create_expense(
      ${communityId}::uuid,
      ${input.concept},
      ${input.category ?? null}::expense_category,
      ${input.amount}::numeric,
      ${input.expenseDate}::date,
      ${input.supplier},
      ${input.invoiceId}::uuid,
      ${input.notes}
    ) as id
  `

  const row = rows[0]

  if (!row?.id) {
    throw new Error('app_create_expense() no devolvió el id')
  }

  return row.id
}

/**
 * Reescribir un gasto (PUT, FN-7).
 *
 * `$executeRaw` porque la funcion devuelve `setof expenses` y la fila se relee
 * despues con `findExpense()`, dentro de la misma transaccion: la respuesta
 * sale de una lectura y no de los parametros de entrada, que es lo unico que
 * garantiza que lo que devuelve la API es lo que quedo escrito.
 *
 * `communityId` no es parametro: la comunidad la decide la propia fila
 * (app_expense_community), y el debate del rol lo dirime la funcion.
 */
export async function updateExpense(
  tx: Tx,
  expenseId: string,
  input: {
    concept: string
    category?: string
    amount: number
    expenseDate: string
    supplier: string | null
    invoiceId: string | null
    notes: string | null
  },
): Promise<void> {
  await tx.$executeRaw`
    select app_update_expense(
      ${expenseId}::uuid,
      ${input.concept},
      ${input.category ?? null}::expense_category,
      ${input.amount}::numeric,
      ${input.expenseDate}::date,
      ${input.supplier},
      ${input.invoiceId}::uuid,
      ${input.notes}
    )
  `
}

/** Borrar un gasto (soft delete, FN-8). La funcion decide el rol y el 404/403. */
export async function deleteExpense(tx: Tx, expenseId: string): Promise<void> {
  await tx.$executeRaw`
    select app_delete_expense(${expenseId}::uuid)
  `
}

/**
 * Crear una factura y devolver su id.
 *
 * El numero unico por comunidad lo garantiza la funcion: captura el
 * `invoices_community_number_uidx` y re-lanza con sentinel `invoice_number_taken`
 * (FN-12). `$queryRaw` porque devuelve `uuid`.
 */
export async function createInvoice(
  tx: Tx,
  communityId: string,
  input: {
    number: string
    concept: string | null
    amount: number
    issueDate: string
    dueDate: string
    supplier: string | null
  },
): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    select app_create_invoice(
      ${communityId}::uuid,
      ${input.number},
      ${input.concept},
      ${input.amount}::numeric,
      ${input.issueDate}::date,
      ${input.dueDate}::date,
      ${input.supplier}
    ) as id
  `

  const row = rows[0]

  if (!row?.id) {
    throw new Error('app_create_invoice() no devolvió el id')
  }

  return row.id
}

/**
 * Pagar una factura (la unica mutacion de estado, FN-6).
 *
 * La funcion decide el conflicto (PAID -> invoice_already_paid, CANCELLED ->
 * invoice_cancelled) y el rol; la fila se relee despues con `findInvoice()` en
 * la misma transaccion para que la respuesta lleve el estado post-pago.
 */
export async function payInvoice(tx: Tx, invoiceId: string): Promise<void> {
  await tx.$executeRaw`
    select app_pay_invoice(${invoiceId}::uuid)
  `
}

/** El resumen economico de la comunidad (spec 09 §5.10). Una fila, garantizada por los coalesce. */
export async function financeSummary(tx: Tx, communityId: string): Promise<SummaryRow | null> {
  const rows = await tx.$queryRaw<SummaryRow[]>`
    select
      expense_total, expense_count, expense_by_category, expense_recent,
      invoice_total, invoice_count, invoice_open_amount, invoice_paid_amount,
      invoice_pending_count, invoice_overdue_count
      from app_finance_summary(${communityId}::uuid)
  `

  return rows[0] ?? null
}
