// ---------------------------------------------------------------------------
// Validacion de entrada de finanzas (zod).
//
// Mismas reglas que en los modulos anteriores: validacion en el borde,
// `.strict()` en todos los esquemas y mensajes en castellano. Lo propio de este
// bloque (spec 09 §7.3):
//
//   - `category` en gastos y `status`/`effectiveStatus` en facturas son ENUM de
//     01_schema.sql y se listan aqui, no se dejan pasar como texto libre: un
//     `$queryRaw` con un `${valor}` sin castear deja que el texto llegue al
//     servidor, y ahi un `::expense_category` con basura revienta con 22P02.
//   - Los limites de longitud son los MISMOS que los CHECK que 02j_FINANCE.sql
//     anade sobre las tablas (`expenses_concept_length`, `expenses_notes_length`,
//     `expenses_supplier_length`, `invoices_number_length`,
//     `invoices_concept_length`, `invoices_supplier_length`). Duplicarlos es
//     inevitable (el backend no puede leer las constraints), pero si los dos
//     sitios dijeran numeros distintos, el que fallara primero seria el segundo
//     check, y el 400 de zod no se veria nunca.
//   - `amount` se limita a 9 999 999 999,99 (FN-9): el `numeric(12,2)` aguanta
//     exactamente eso, y un importe mayor romperia el JSON.
//   - Las fechas van `YYYY-MM-DD` estricto (mismo esquema `fecha` que
//     reservations/validators.ts): `2026-2-5` es un 400, no algo a arreglar. La
//     comparacion `from <= to`, `dueDate >= issueDate` se hace con fechas de
//     verdad, no por texto.
//   - El `PUT /expenses/:id` es reemplazo completo (FN-7): comparte forma con
//     el POST, y `supplier`/`notes`/`invoiceId` aceptan `null` explicito para
//     limpiar el valor (misma decision que `expiresAt` en avisos).
//   - `userId` y `communityId` no se aceptan en ningun cuerpo: el primero lo
//     pone la sesion dentro de la funcion y la segunda la decide la URL.
//
// Los campos que NO estan en ningun esquema lo estan a proposito: `id`,
// `createdBy`, `createdAt`, `updatedAt`, `status`, `paidAt`... mandarlos es un
// 400 explicito por `.strict()`.
// ---------------------------------------------------------------------------

import { z } from 'zod'

/** Los siete valores de `expense_category` (01_schema.sql). */
export const CATEGORIAS = [
  'MAINTENANCE',
  'CLEANING',
  'SECURITY',
  'UTILITIES',
  'ADMIN',
  'INSURANCE',
  'OTHER',
] as const

/** Los cuatro estados de `invoice_status` (01_schema.sql). OVERDUE se filtra por el estado efectivo (FN-14). */
export const ESTADOS = ['PENDING', 'PAID', 'OVERDUE', 'CANCELLED'] as const

/** Mismo criterio que `members/validators.ts` (C-9). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Fecha con formato estricto `YYYY-MM-DD`, sin normalizar.
 *
 * `2026-2-5` es un 400, no una fecha que se arregla: aceptar variantes haria
 * que dos clientes pidieran "el mismo dia" y el backend resolviera dias
 * distintos. El `.refine` del calendario evita el clasico `2026-02-31`, que la
 * regex deja pasar y que `::date` en Postgres rechazaria con un error poco
 * claro.
 */
const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener el formato YYYY-MM-DD.')
  .refine((valor) => {
    const partes = valor.split('-')
    const anio = Number(partes[0])
    const mes = Number(partes[1])
    const dia = Number(partes[2])
    const d = new Date(Date.UTC(anio, mes - 1, dia))
    return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia
  }, 'Esa fecha no existe en el calendario.')

/** El importe, en el rango del `numeric(12,2)` (FN-9). */
const importe = () =>
  z
    .number('El importe debe ser un número.')
    .positive('El importe debe ser mayor que 0.')
    .max(9_999_999_999.99, 'El importe no puede pasar de 9 999 999 999,99.')

const concepto = z
  .string()
  .trim()
  .min(1, 'El concepto es obligatorio.')
  .max(120, 'El concepto no puede pasar de 120 caracteres.')

const textoOpcional = (max: number, nombre: string) =>
  z
    .string()
    .trim()
    .max(max, `${nombre} no puede pasar de ${max} caracteres.`)
    .nullish()
    .transform((valor) => (valor ? valor : null))

/** Texto opcional largo: el `''` y `null` acaban en el mismo `null` (FN-7). */
const notas = textoOpcional(1000, 'Las notas')
const proveedor = textoOpcional(200, 'El proveedor')

/**
 * Alta de un gasto (POST) y su reemplazo completo (PUT).
 *
 * La misma forma para los dos (FN-7): la unica diferencia es que en el PUT
 * `supplier`/`notes`/`invoiceId` admiten `null` explicito para limpiar. Como el
 * `.nullish()` ya convierte lo ausente y lo nulo al mismo sitio, un solo esquema
 * sirve: aqui "no mandarlo" y "mandarlo nulo" significan lo mismo que en el SQL
 * (`nullif`), que es "limpiar". El POST que quiera dejar el supplier sin tocar
 * no lo manda: no existe estado anterior en un alta.
 *
 * `invoiceId`, si viene, debe tener forma de UUID: un `::uuid` sobre basura
 * reventaria con 22P02. Que sea de la MISMA comunidad lo decide la funcion con
 * `expense_invoice_mismatch` (FN-10), no este esquema.
 */
export const expenseSchema = z
  .object({
    concept: concepto,
    category: z.enum(CATEGORIAS).optional(),
    amount: importe(),
    expenseDate: fecha,
    supplier: proveedor,
    invoiceId: z
      .string()
      .regex(UUID_RE, 'invoiceId debe ser un UUID.')
      .nullish()
      .transform((v) => v ?? null),
    notes: notas,
  })
  .strict()

/**
 * Alta de una factura (POST).
 *
 * `number` unico por comunidad lo garantiza el indice
 * `invoices_community_number_uidx`, capturado en la funcion con
 * `invoice_number_taken` (FN-12); aqui no se comprueba nada. `dueDate >=
 * issueDate` se comprueba con fechas de verdad y no por texto (dos `YYYY-MM-DD`
 * se comparan bien por string, pero el esquema `fecha` ya desambigua).
 */
export const createInvoiceSchema = z
  .object({
    number: z
      .string()
      .trim()
      .min(1, 'El número de factura es obligatorio.')
      .max(50, 'El número de factura no puede pasar de 50 caracteres.'),
    concept: textoOpcional(120, 'El concepto'),
    amount: importe(),
    issueDate: fecha,
    dueDate: fecha,
    supplier: proveedor,
  })
  .strict()
  .superRefine((datos, ctx) => {
    if (Date.parse(datos.dueDate) < Date.parse(datos.issueDate)) {
      ctx.addIssue({
        code: 'custom',
        message: 'El vencimiento no puede ser anterior a la emisión.',
        path: ['dueDate'],
      })
    }
  })

/**
 * Filtros del listado de gastos (spec 09 §7.3).
 *
 * Se validan aqui y no se pasan como texto al SQL por dos motivos. El primero
 * es el `::expense_category`: sin el cast, `category=inventado` llegaria como
 * texto y Postgres lo rechazaria con 22P02, que es un 500 si nadie lo traduce.
 * El segundo es el `offset`, que tiene que ser un entero de verdad.
 *
 * `page` y no `offset`: la API expone `meta.page`, que es lo que consume el
 * cliente, y convertirlo aqui evita que el servicio tenga que restar uno en un
 * solo sitio.
 *
 * Parametros desconocidos (`?q=`) son 400 por `.strict()`.
 */
export const expensesQuerySchema = z
  .object({
    from: fecha.optional(),
    to: fecha.optional(),
    category: z.enum(CATEGORIAS).optional(),
    page: z.coerce
      .number()
      .int('La página debe ser un número entero.')
      .min(1, 'La página empieza en 1.')
      .optional(),
    limit: z.coerce
      .number()
      .int('El límite debe ser un número entero.')
      .min(1)
      .max(100, 'El límite máximo es 100.')
      .optional(),
  })
  .strict()
  .superRefine((datos, ctx) => {
    if (datos.from && datos.to && Date.parse(datos.from) > Date.parse(datos.to)) {
      ctx.addIssue({
        code: 'custom',
        message: 'La fecha "to" no puede ser anterior a "from".',
        path: ['to'],
      })
    }
  })

/**
 * Filtros del listado de facturas (spec 09 §7.3).
 *
 * `status=OVERDUE` es legitimo: `app_list_invoices()` compara con el ESTADO
 * EFECTIVO (FN-14), de modo que el filtro devuelve las vencidas sin que exista
 * la fila 'OVERDUE' en la tabla.
 */
export const invoicesQuerySchema = z
  .object({
    status: z.enum(ESTADOS).optional(),
    page: z.coerce
      .number()
      .int('La página debe ser un número entero.')
      .min(1, 'La página empieza en 1.')
      .optional(),
    limit: z.coerce
      .number()
      .int('El límite debe ser un número entero.')
      .min(1)
      .max(100, 'El límite máximo es 100.')
      .optional(),
  })
  .strict()

/** `pay` no lleva cuerpo (spec 09 §7.3). Un cuerpo con algo dentro es un 400 por `.strict()`. */
export const payBodySchema = z.object({}).strict()

/**
 * Un UUID de ruta.
 *
 * Se exporta como esquema para que el controller lo valide con el mismo `parse`
 * que usa para los cuerpos, en vez de un segundo camino de validacion.
 */
export const uuidSchema = z.string().regex(UUID_RE, 'Debe ser un UUID.')

/** Los valores admitidos, para los mensajes de error de los tests. */
export const CATEGORIAS_VALIDAS = CATEGORIAS
export const ESTADOS_VALIDOS = ESTADOS

export type ExpenseInput = z.infer<typeof expenseSchema>
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>
export type ExpensesQueryInput = z.infer<typeof expensesQuerySchema>
export type InvoicesQueryInput = z.infer<typeof invoicesQuerySchema>
