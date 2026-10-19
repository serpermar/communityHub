// ---------------------------------------------------------------------------
// Traduccion de los errores de PL/pgSQL a HTTP (finanzas).
//
// Tests unitarios: la traduccion se decide por el PAR (errcode, sentinel), y la
// combinacion de las dos se puede fabricar aqui sin base de datos.
//
// Lo propio de este bloque (spec 09 §7.5, FN-12) es que los TRES conflictos
// comparten el SQLSTATE U0001 y solo se distinguen por el sentinel:
//
//   - `invoice_number_taken`, `invoice_already_paid` e `invoice_cancelled`
//     salen los tres como (U0001, sentinel) y cada uno tiene su codigo estable
//     (INVOICE_NUMBER_TAKEN / INVOICE_ALREADY_PAID / INVOICE_CANCELLED), nunca
//     el generico CONFLICT. Por eso un U0001 SIN sentinel NO es un 409: es un
//     bug del esquema (un uuid v4 no colisiona) y se deja pasar como 500.
//   - `expense_invoice_mismatch` (FN-10) es el unico 400 del bloque con codigo
//     propio (EXPENSE_INVOICE_MISMATCH) en vez de VALIDATION_ERROR.
// ---------------------------------------------------------------------------

import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { AppError } from '../../http/errors.js'
import { ejecuta, translate } from '../errors.js'

function errorDePostgres(errcode: string, message: string): unknown {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code: 'P2010',
    clientVersion: 'test',
    meta: { code: errcode, message },
  })
}

describe('translate', () => {
  it('mapea (P0002, expense_not_found) a un 404', () => {
    const error = translate(
      errorDePostgres('P0002', 'expense_not_found: no existe o no es visible'),
    )

    expect(error?.status).toBe(404)
    expect(error?.code).toBe('NOT_FOUND')
  })

  it('mapea (P0002, invoice_not_found) a un 404', () => {
    const error = translate(
      errorDePostgres('P0002', 'invoice_not_found: no existe o no es visible'),
    )

    expect(error?.status).toBe(404)
    expect(error?.code).toBe('NOT_FOUND')
  })

  it('mapea (42501, forbidden_role) a un 403 generico de rol', () => {
    const error = translate(
      errorDePostgres('42501', 'forbidden_role: no es miembro de la comunidad'),
    )

    expect(error?.status).toBe(403)
    expect(error?.code).toBe('FORBIDDEN')
  })

  it('mapea (42501, expense_requires_admin) a un 403 de gastos', () => {
    const error = translate(errorDePostgres('42501', 'expense_requires_admin: solo un ADMIN'))

    expect(error?.status).toBe(403)
    expect(error?.message).toBe('Solo un administrador puede gestionar gastos.')
  })

  it('mapea (42501, invoice_requires_admin) a un 403 de facturas', () => {
    const error = translate(errorDePostgres('42501', 'invoice_requires_admin: solo un ADMIN'))

    expect(error?.status).toBe(403)
    expect(error?.message).toBe('Solo un administrador puede gestionar facturas.')
  })

  it('mapea (22023, expense_content_required) a un 400', () => {
    const error = translate(
      errorDePostgres('22023', 'expense_content_required: el concepto es obligatorio'),
    )

    expect(error?.status).toBe(400)
  })

  it('mapea (22023, expense_amount_invalid) a un 400', () => {
    const error = translate(
      errorDePostgres('22023', 'expense_amount_invalid: el importe debe ser mayor que 0'),
    )

    expect(error?.status).toBe(400)
    expect(error?.code).toBe('VALIDATION_ERROR')
  })

  it('mapea (22023, expense_invoice_mismatch) a un 400 con codigo propio (FN-10)', () => {
    // Un 400, pero NO con VALIDATION_ERROR: el cliente distingue "factura de
    // otra comunidad" de "body mal formado".
    const error = translate(
      errorDePostgres('22023', 'expense_invoice_mismatch: la factura no es de esta comunidad'),
    )

    expect(error?.status).toBe(400)
    expect(error?.code).toBe('EXPENSE_INVOICE_MISMATCH')
  })

  it('mapea (22023, invoice_content_required) a un 400', () => {
    const error = translate(
      errorDePostgres('22023', 'invoice_content_required: el número es obligatorio'),
    )

    expect(error?.status).toBe(400)
  })

  it('mapea (22023, invoice_amount_invalid) a un 400', () => {
    const error = translate(
      errorDePostgres('22023', 'invoice_amount_invalid: el importe debe ser mayor que 0'),
    )

    expect(error?.status).toBe(400)
  })

  it('mapea (22023, invoice_dates_invalid) a un 400', () => {
    const error = translate(
      errorDePostgres('22023', 'invoice_dates_invalid: el vencimiento no puede ser anterior'),
    )

    expect(error?.status).toBe(400)
  })

  it('mapea (U0001, invoice_number_taken) a un 409 INVOICE_NUMBER_TAKEN', () => {
    const error = translate(errorDePostgres('U0001', 'invoice_number_taken: número duplicado'))

    expect(error?.status).toBe(409)
    expect(error?.code).toBe('INVOICE_NUMBER_TAKEN')
  })

  it('mapea (U0001, invoice_already_paid) a un 409 INVOICE_ALREADY_PAID', () => {
    const error = translate(
      errorDePostgres('U0001', 'invoice_already_paid: esa factura ya está pagada'),
    )

    expect(error?.status).toBe(409)
    expect(error?.code).toBe('INVOICE_ALREADY_PAID')
  })

  it('mapea (U0001, invoice_cancelled) a un 409 INVOICE_CANCELLED', () => {
    const error = translate(
      errorDePostgres('U0001', 'invoice_cancelled: una factura cancelada no se paga'),
    )

    expect(error?.status).toBe(409)
    expect(error?.code).toBe('INVOICE_CANCELLED')
  })

  it('distingue los tres conflictos de U0001 por el sentinel, no por el errcode', () => {
    const numeros = new Set([
      translate(errorDePostgres('U0001', 'invoice_number_taken'))?.code,
      translate(errorDePostgres('U0001', 'invoice_already_paid'))?.code,
      translate(errorDePostgres('U0001', 'invoice_cancelled'))?.code,
    ])

    expect(numeros).toEqual(
      new Set(['INVOICE_NUMBER_TAKEN', 'INVOICE_ALREADY_PAID', 'INVOICE_CANCELLED']),
    )
  })

  it('mapea la falta de contexto de usuario a un 401', () => {
    const error = translate(errorDePostgres('42501', 'sin contexto de usuario'))

    expect(error?.status).toBe(401)
    expect(error?.code).toBe('UNAUTHORIZED')
  })

  it('un sentinel SIN su errcode no se convierte en el error de negocio', () => {
    // 23514 con el texto del sentinel de gasto inexistente: si la traduccion
    // mirara solo el mensaje, seria un 404 cuando es un CHECK.
    const error = translate(
      errorDePostgres(
        '23514',
        'expense_not_found: violates check constraint "expenses_concept_length"',
      ),
    )

    expect(error?.status).toBe(400)
    expect(error?.code).toBe('VALIDATION_ERROR')
  })

  it('un sentinel con un errcode de otro tipo no se mezcla con otro caso', () => {
    // expense_invoice_mismatch con P0002 no es ni el 400 de mismatch ni un
    // 404: P0002 solo es caso de negocio con el sentinel _not_found, asi que
    // cae al final y se deja pasar como 500.
    expect(translate(errorDePostgres('P0002', 'expense_invoice_mismatch: lo que sea'))).toBeNull()

    // invoice_number_taken con 22023 no es un 409.
    const con22023 = translate(errorDePostgres('22023', 'invoice_number_taken: lo que sea'))
    expect(con22023?.status).toBe(400)

    // Y sin sentinel de negocio tampoco.
    expect(translate(errorDePostgres('23505', 'invoice_number_taken: lo que sea'))).toBeNull()
  })

  it('un U0001 SIN su sentinel NO se convierte en 409', () => {
    // El complemento de los tres conflictos: el SQLSTATE conflictivo llego,
    // pero el mensaje no lleva sentinel. Eso no es un conflicto previsto — es
    // un bug del esquema, y como los demas erricodes desconocidos se deja
    // pasar como 500.
    expect(translate(errorDePostgres('U0001', 'un error de conflicto cualquiera'))).toBeNull()
  })

  it('un 42501 sin sentinel conocido es un 403 y no un 500', () => {
    const error = translate(errorDePostgres('42501', 'new row violates row-level security policy'))

    expect(error?.status).toBe(403)
  })

  it('un 23514 sin sentinel es un 400', () => {
    const error = translate(
      errorDePostgres('23514', 'violates check constraint "invoices_amount_positive"'),
    )

    expect(error?.status).toBe(400)
  })

  it('un 22P02 es un 400, no un 500', () => {
    const error = translate(
      errorDePostgres('22P02', 'invalid input syntax for type expense_category'),
    )

    expect(error?.status).toBe(400)
  })

  it('un 22023 sin sentinel es un 400', () => {
    const error = translate(errorDePostgres('22023', 'invalid_parameter_value'))

    expect(error?.status).toBe(400)
  })

  it('devuelve null si el error no viene de PostgreSQL', () => {
    expect(translate(new Error('fallo de Javascript'))).toBeNull()
    expect(translate('una cadena')).toBeNull()
    expect(translate(undefined)).toBeNull()
  })

  it('devuelve null si viene de Prisma pero no de una consulta en crudo', () => {
    const otro = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
    })

    expect(translate(otro)).toBeNull()
  })

  it('devuelve null si el error de Postgres no es ninguno de los casos conocidos', () => {
    expect(translate(errorDePostgres('53200', 'out of memory'))).toBeNull()
    expect(translate(errorDePostgres('XX000', 'error interno de la base de datos'))).toBeNull()
  })
})

describe('ejecuta', () => {
  it('devuelve el resultado cuando la accion va bien', async () => {
    await expect(ejecuta(async () => 42)).resolves.toBe(42)
  })

  it('traduce un error de base de datos y lo lanza', async () => {
    await expect(
      ejecuta(async () => {
        throw errorDePostgres('P0002', 'expense_not_found: no existe')
      }),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })

  it('deja intacto un AppError que ya es del dominio', async () => {
    const propio = new AppError(
      400,
      'EXPENSE_INVOICE_MISMATCH',
      'La factura debe pertenecer a la misma comunidad.',
    )

    await expect(
      ejecuta(async () => {
        throw propio
      }),
    ).rejects.toBe(propio)
  })

  it('re-lanza tal cual un error desconocido (acabara en 500)', async () => {
    const raro = new Error('algo se rompio')

    await expect(
      ejecuta(async () => {
        throw raro
      }),
    ).rejects.toBe(raro)
  })
})
