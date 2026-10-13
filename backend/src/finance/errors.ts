// ---------------------------------------------------------------------------
// Del sentinel de PL/pgSQL al error HTTP (finanzas).
//
// Las funciones de 02j_finance.sql levantan los casos de negocio con un
// sentinel al principio del mensaje y un `errcode` de Postgres. Este archivo
// es el unico sitio que sabe traducirlos, y el unico que decide que un 42501
// es un 403 y no un 500.
//
// Se exige EL PAR de las dos cosas y no solo el sentinel (R-12): un sentinel
// es una cadena de texto, y cualquier titulo o descripcion del cliente puede
// acabar dentro del mensaje de un error de Postgres. Con el par, un cuerpo
// que se llamase `expense_not_found` no puede convertirse en un 404.
//
// Particularidades del bloque (spec 09 §7.5, FN-12):
//
//   - Los tres 409 comparten SQLSTATE U0001 —"conflicto del bloque de
//     finanzas" a proposito: Prisma (P2010) traduce cualquier 23505 real a su
//     mensaje generico y se come el sentinel, mientras que un SQLSTATE propio
//     viaja entero al cliente. La traduccion exige el sentinel para
//     distinguirlos: sin sentinel, un 23505/U0001 desnudo NO se convierte en
//     409, es un bug del esquema (un uuid v4 no colisiona). Cada 409 lleva su
//     codigo estable de contrato (INVOICE_ALREADY_PAID, INVOICE_CANCELLED,
//     INVOICE_NUMBER_TAKEN), no el generico CONFLICT.
//   - `expense_invoice_mismatch` (FN-10) es el unico caso del bloque con
//     codigo de contrato propio fuera de `badRequest()`: es un 400, pero con
//     su codigo EXPENSE_INVOICE_MISMATCH y no VALIDATION_ERROR. Se construye
//     con `new AppError` directamente: `badRequest()` fija el codigo por
//     definicion.
// ---------------------------------------------------------------------------

import { Prisma } from '@prisma/client'
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from '../http/errors.js'

/** El `errcode` y el mensaje que PostgreSQL trae al cliente de Prisma. */
type Origen = { errcode: string; message: string }

/**
 * Saca el par (errcode, mensaje) de un fallo de `$queryRaw` / `$executeRaw`.
 * Un fallo de consulta en crudo SIEMPRE llega como `P2010`, con el codigo de
 * PostgreSQL en `meta.code` y no en `message`.
 */
function dePostgres(error: unknown): Origen | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null
  if (error.code !== 'P2010') return null

  const errcode = error.meta?.code
  const message = error.meta?.message

  if (typeof errcode !== 'string' || typeof message !== 'string') return null

  return { errcode, message }
}

/** Los casos de negocio de este bloque, segun la tabla de la spec 09 §7.5. */
const NEGOCIO: ReadonlyArray<{ sentinel: string; errcode: string; error: () => AppError }> = [
  {
    // No existe, es de otra comunidad, esta borrado o no te ve como ADMIN. Las
    // cuatro son el mismo 404 y por el mismo motivo (C-8): un 403 confirmaria
    // que ese id existe (spec 09 §7.4).
    sentinel: 'expense_not_found',
    errcode: 'P0002',
    error: () => notFound('Ese gasto no existe o no es visible.'),
  },
  {
    sentinel: 'invoice_not_found',
    errcode: 'P0002',
    error: () => notFound('Esa factura no existe o no es visible.'),
  },
  {
    // El listado/alta/pago/resumen por un rol que no da para abrir la
    // tesoreria (FN-1). Mismo sentinel para no-miembro y no-ADMIN, como en los
    // bloques 04-08.
    sentinel: 'forbidden_role',
    errcode: '42501',
    error: () => forbidden('Tu rol en esta comunidad no permite esta acción.'),
  },
  {
    // Editar o borrar un gasto por un PRESIDENT: solo ADMIN (FN-1).
    sentinel: 'expense_requires_admin',
    errcode: '42501',
    error: () => forbidden('Solo un administrador puede gestionar gastos.'),
  },
  {
    sentinel: 'invoice_requires_admin',
    errcode: '42501',
    error: () => forbidden('Solo un administrador puede gestionar facturas.'),
  },
  {
    // Guarda interna del alta/actualizacion, inalcanzable desde la API (zod
    // exige concepto 1-120). Esta igualmente para una llamada directa.
    sentinel: 'expense_content_required',
    errcode: '22023',
    error: () => badRequest('El concepto es obligatorio.'),
  },
  {
    // Red para el CHECK expenses_amount_positive; el zod lo adelanta.
    sentinel: 'expense_amount_invalid',
    errcode: '22023',
    error: () => badRequest('El importe debe ser mayor que 0.'),
  },
  {
    // FN-10: la factura vinculada no es de la misma comunidad. Un 400 con su
    // codigo de contrato, no VALIDATION_ERROR (spec 09 §7.4).
    sentinel: 'expense_invoice_mismatch',
    errcode: '22023',
    error: () => new AppError(400, 'EXPENSE_INVOICE_MISMATCH', 'La factura debe pertenecer a la misma comunidad.'),
  },
  {
    sentinel: 'invoice_content_required',
    errcode: '22023',
    error: () => badRequest('El número de factura es obligatorio.'),
  },
  {
    sentinel: 'invoice_amount_invalid',
    errcode: '22023',
    error: () => badRequest('El importe debe ser mayor que 0.'),
  },
  {
    // Red para el CHECK invoices_dates_valid; el superRefine del zod lo adelanta.
    sentinel: 'invoice_dates_invalid',
    errcode: '22023',
    error: () => badRequest('El vencimiento no puede ser anterior a la emisión.'),
  },
  {
    // El `invoices_community_number_uidx` exploto dentro de app_create_invoice,
    // que lo captura y lo re-lanza con sentinel (FN-12).
    sentinel: 'invoice_number_taken',
    errcode: 'U0001',
    error: () =>
      conflict('INVOICE_NUMBER_TAKEN', 'Ya existe una factura con ese número en esta comunidad.'),
  },
  {
    // FN-6: pagar dos veces no es un 200 idempotente, es un conflicto.
    sentinel: 'invoice_already_paid',
    errcode: 'U0001',
    error: () => conflict('INVOICE_ALREADY_PAID', 'Esa factura ya está pagada.'),
  },
  {
    // CANCELLED solo se alcanza por SQL directo (fuera de alcance por API);
    // pagar una es un conflicto que el cliente debe ver, no un 500.
    sentinel: 'invoice_cancelled',
    errcode: 'U0001',
    error: () => conflict('INVOICE_CANCELLED', 'Una factura cancelada no se puede pagar.'),
  },
  { sentinel: 'sin contexto de usuario', errcode: '42501', error: () => unauthorized() },
]

/**
 * Traduce un error de la base de datos al error de HTTP que le corresponde.
 * Devuelve `null` cuando el error no viene de PostgreSQL o no es un caso
 * conocido: quien llama lo vuelve a lanzar tal cual y el middleware de errores
 * lo acaba devolviendo como 500.
 */
export function translate(error: unknown): AppError | null {
  const origen = dePostgres(error)

  if (!origen) return null

  for (const caso of NEGOCIO) {
    if (origen.errcode === caso.errcode && origen.message.includes(caso.sentinel)) {
      return caso.error()
    }
  }

  // Sin sentinel, un 23505/U0001 NO se convierte en 409: ver la cabecera.
  // Los tres conflictos del bloque siempre viajan con su sentinel.

  // CHECK de longitud o de dominio reventado en la tabla: 23514 sin sentinel
  // -> 400. El caso normal lo intercepta zod en la entrada; este es el plan B.
  if (origen.errcode === '23514') {
    return badRequest('Uno de los campos no cumple el formato permitido.')
  }

  // Enum, uuid o jsonb invalido: zod los valida antes, pero si llegaran...
  if (origen.errcode === '22P02') return badRequest('Uno de los valores enviados no es válido.')

  // 22023 sin sentinel: los que estas funciones saben levantar son problemas de
  // datos de entrada, asi que un 400 es la respuesta honesta.
  if (origen.errcode === '22023') return badRequest('Uno de los valores enviados no es válido.')

  // Sin sentinel conocido, 42501 sigue siendo inequivoco: si una politica de
  // RLS se cerrara de mas, el sintoma es un 403 y no un 500.
  if (origen.errcode === '42501') return forbidden()

  return null
}

/**
 * Ejecuta una accion y traduce sus errores de base de datos. Un `AppError` que
 * ya es del dominio pasa intacto: `translate` devuelve `null` y lo relanza.
 */
export async function ejecuta<T>(accion: () => Promise<T>): Promise<T> {
  try {
    return await accion()
  } catch (error) {
    throw translate(error) ?? error
  }
}