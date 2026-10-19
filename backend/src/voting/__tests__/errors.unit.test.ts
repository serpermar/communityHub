// ---------------------------------------------------------------------------
// Traduccion de los errores de PL/pgSQL a HTTP (votaciones).
//
// Tests unitarios: la traduccion se decide por el PAR (errcode, sentinel), y la
// combinacion de las dos se puede fabricar aqui sin base de datos.
//
// Lo propio de este bloque (spec 10 §7.5):
//
//   - Los CINCO conflictos comparten SQLSTATE U0001 y solo se distinguen por el
//     sentinel; cada uno tiene su codigo estable (VOTE_NOT_DRAFT / VOTE_NOT_OPEN
//     / VOTE_CLOSED / VOTE_ALREADY_CLOSED / VOTE_NOT_PUBLISHED), nunca el
//     generico CONFLICT. Un U0001 SIN sentinel NO es un 409: es un bug del
//     esquema y se deja pasar como 500.
//   - `vote_option_invalid` y `vote_option_duplicate` son los dos 400 con codigo
//     propio (VOTE_OPTION_INVALID / VOTE_OPTION_DUPLICATE) en vez de
//     VALIDATION_ERROR.
//   - `vote_option_invalid` NO es lo mismo que `vote_options_invalid`: el par
//     (22023, sentinel) tiene que distinguirlos, y el orden de la tabla de casos
//     no puede hacer que uno se coma al otro.
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
  it('mapea (P0002, vote_not_found) a un 404', () => {
    const error = translate(errorDePostgres('P0002', 'vote_not_found: no existe o no es visible'))

    expect(error?.status).toBe(404)
    expect(error?.code).toBe('NOT_FOUND')
  })

  it('mapea (42501, forbidden_role) a un 403 generico de rol', () => {
    const error = translate(
      errorDePostgres('42501', 'forbidden_role: no puedes ver las votaciones'),
    )

    expect(error?.status).toBe(403)
    expect(error?.code).toBe('FORBIDDEN')
    expect(error?.message).toBe('Tu rol en esta comunidad no permite esta acción.')
  })

  it('mapea (42501, vote_requires_leadership) a un 403 de gestion', () => {
    const error = translate(
      errorDePostgres('42501', 'vote_requires_leadership: solo la presidencia o un administrador'),
    )

    expect(error?.status).toBe(403)
    expect(error?.code).toBe('FORBIDDEN')
    expect(error?.message).toBe(
      'Solo la presidencia o un administrador puede gestionar votaciones.',
    )
  })

  it('mapea (42501, vote_results_forbidden) a un 403 de resultados', () => {
    const error = translate(
      errorDePostgres('42501', 'vote_results_forbidden: los resultados no son visibles'),
    )

    expect(error?.status).toBe(403)
    expect(error?.code).toBe('FORBIDDEN')
    expect(error?.message).toBe('Los resultados de esta votación todavía no son visibles.')
  })

  it('mapea (22023, vote_content_required) a un 400', () => {
    const error = translate(
      errorDePostgres('22023', 'vote_content_required: el título es obligatorio'),
    )

    expect(error?.status).toBe(400)
    expect(error?.code).toBe('VALIDATION_ERROR')
  })

  it('mapea (22023, vote_dates_invalid) a un 400', () => {
    const error = translate(
      errorDePostgres('22023', 'vote_dates_invalid: la fecha de cierre debe ser posterior'),
    )

    expect(error?.status).toBe(400)
    expect(error?.code).toBe('VALIDATION_ERROR')
  })

  it('mapea (22023, vote_quorum_invalid) a un 400', () => {
    const error = translate(
      errorDePostgres('22023', 'vote_quorum_invalid: el quórum debe estar entre 1 y 100'),
    )

    expect(error?.status).toBe(400)
  })

  it('mapea (22023, vote_options_invalid) a un 400 VALIDATION_ERROR', () => {
    const error = translate(
      errorDePostgres('22023', 'vote_options_invalid: se necesitan al menos dos opciones'),
    )

    expect(error?.status).toBe(400)
    expect(error?.code).toBe('VALIDATION_ERROR')
  })

  it('mapea (22023, vote_option_invalid) a un 400 VOTE_OPTION_INVALID', () => {
    const error = translate(
      errorDePostgres('22023', 'vote_option_invalid: esa opción no es de esta votación'),
    )

    expect(error?.status).toBe(400)
    expect(error?.code).toBe('VOTE_OPTION_INVALID')
  })

  it('mapea (22023, vote_option_duplicate) a un 400 VOTE_OPTION_DUPLICATE', () => {
    const error = translate(
      errorDePostgres('22023', 'vote_option_duplicate: hay opciones repetidas'),
    )

    expect(error?.status).toBe(400)
    expect(error?.code).toBe('VOTE_OPTION_DUPLICATE')
  })

  it('no confunde vote_option_invalid con vote_options_invalid', () => {
    // Los dos son 22023 y se parecen; el par (errcode, sentinel) los separa.
    expect(translate(errorDePostgres('22023', 'vote_option_invalid'))?.code).toBe(
      'VOTE_OPTION_INVALID',
    )
    expect(translate(errorDePostgres('22023', 'vote_options_invalid'))?.code).toBe(
      'VALIDATION_ERROR',
    )
  })

  it('mapea los cinco conflictos U0001 a sus codigos propios', () => {
    const casos: Array<[string, string]> = [
      ['vote_not_draft', 'VOTE_NOT_DRAFT'],
      ['vote_not_open', 'VOTE_NOT_OPEN'],
      ['vote_closed', 'VOTE_CLOSED'],
      ['vote_already_closed', 'VOTE_ALREADY_CLOSED'],
      ['vote_not_published', 'VOTE_NOT_PUBLISHED'],
    ]

    for (const [sentinel, code] of casos) {
      const error = translate(errorDePostgres('U0001', `${sentinel}: lo que sea`))
      expect(error?.status, sentinel).toBe(409)
      expect(error?.code, sentinel).toBe(code)
    }
  })

  it('no confunde vote_closed con vote_already_closed', () => {
    expect(translate(errorDePostgres('U0001', 'vote_closed'))?.code).toBe('VOTE_CLOSED')
    expect(translate(errorDePostgres('U0001', 'vote_already_closed'))?.code).toBe(
      'VOTE_ALREADY_CLOSED',
    )
  })

  it('mapea la falta de contexto de usuario a un 401', () => {
    const error = translate(errorDePostgres('42501', 'sin contexto de usuario'))

    expect(error?.status).toBe(401)
    expect(error?.code).toBe('UNAUTHORIZED')
  })

  it('un U0001 SIN su sentinel NO se convierte en 409', () => {
    expect(translate(errorDePostgres('U0001', 'un error de conflicto cualquiera'))).toBeNull()
  })

  it('un sentinel SIN su errcode no se convierte en el error de negocio', () => {
    const error = translate(
      errorDePostgres('23514', 'vote_not_found: violates check constraint "votes_title_length"'),
    )

    expect(error?.status).toBe(400)
    expect(error?.code).toBe('VALIDATION_ERROR')
  })

  it('un 42501 sin sentinel conocido es un 403 y no un 500', () => {
    const error = translate(errorDePostgres('42501', 'new row violates row-level security policy'))

    expect(error?.status).toBe(403)
  })

  it('un 22023 sin sentinel es un 400', () => {
    expect(translate(errorDePostgres('22023', 'invalid_parameter_value'))?.status).toBe(400)
  })

  it('un 22P02 es un 400, no un 500', () => {
    expect(
      translate(errorDePostgres('22P02', 'invalid input syntax for type vote_type'))?.status,
    ).toBe(400)
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

  it('devuelve null si el errcode no es ninguno de los conocidos', () => {
    expect(translate(errorDePostgres('53200', 'out of memory'))).toBeNull()
    expect(translate(errorDePostgres('XX000', 'error interno'))).toBeNull()
  })
})

describe('ejecuta', () => {
  it('devuelve el resultado cuando la accion va bien', async () => {
    await expect(ejecuta(async () => 42)).resolves.toBe(42)
  })

  it('traduce un error de base de datos y lo lanza', async () => {
    await expect(
      ejecuta(async () => {
        throw errorDePostgres('P0002', 'vote_not_found: no existe')
      }),
    ).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' })
  })

  it('deja intacto un AppError que ya es del dominio', async () => {
    const propio = new AppError(
      400,
      'VOTE_OPTION_INVALID',
      'Esa opción no pertenece a esta votación.',
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
