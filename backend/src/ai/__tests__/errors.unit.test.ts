// ---------------------------------------------------------------------------
// Traduccion de los errores de 02l_ai.sql y del proveedor LLM a HTTP (IA).
//
// Tests unitarios: la traduccion se decide por el PAR (errcode, sentinel), y la
// combinacion de los dos se puede fabricar aqui sin base de datos.
//
// Lo propio de este bloque:
//
//   - `draft_not_found` y `session_not_found` comparten SQLSTATE P0002 y solo se
//     distinguen por el sentinel: el primero es INCIDENT_DRAFT_NOT_FOUND y el
//     segundo CHAT_SESSION_NOT_FOUND.
//   - Los tres conflictos del borrador comparten U0001: `draft_already_confirmed`
//     tiene codigo propio, y `draft_not_pending` y `draft_expired` se funden en
//     INCIDENT_DRAFT_NOT_PENDING.
//   - `LLMProviderError` se traduce a 502 AI_PROVIDER_ERROR; es lo que separa un
//     fallo del proveedor de un 500 del backend.
// ---------------------------------------------------------------------------

import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { LLMProviderError } from '../llm/client.js'
import { aiNotConfigured, ejecuta, translate } from '../errors.js'

function errorDePostgres(errcode: string, message: string): unknown {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code: 'P2010',
    clientVersion: 'test',
    meta: { code: errcode, message },
  })
}

describe('fabricas de codigos', () => {
  it('AI_NOT_CONFIGURED es un 503', () => {
    const error = aiNotConfigured()
    expect(error.status).toBe(503)
    expect(error.code).toBe('AI_NOT_CONFIGURED')
  })
})

describe('translate', () => {
  it('mapea (P0002, draft_not_found) a INCIDENT_DRAFT_NOT_FOUND', () => {
    const error = translate(errorDePostgres('P0002', 'draft_not_found: no existe o no es tuyo'))

    expect(error?.status).toBe(404)
    expect(error?.code).toBe('INCIDENT_DRAFT_NOT_FOUND')
  })

  it('mapea (P0002, session_not_found) a CHAT_SESSION_NOT_FOUND', () => {
    const error = translate(errorDePostgres('P0002', 'session_not_found: la sesión no existe'))

    expect(error?.status).toBe(404)
    expect(error?.code).toBe('CHAT_SESSION_NOT_FOUND')
  })

  it('no confunde draft_not_found con session_not_found', () => {
    expect(translate(errorDePostgres('P0002', 'draft_not_found'))?.code).toBe(
      'INCIDENT_DRAFT_NOT_FOUND',
    )
    expect(translate(errorDePostgres('P0002', 'session_not_found'))?.code).toBe(
      'CHAT_SESSION_NOT_FOUND',
    )
  })

  it('mapea (42501, forbidden_role) a un 403', () => {
    const error = translate(errorDePostgres('42501', 'forbidden_role: no eres miembro'))
    expect(error?.status).toBe(403)
    expect(error?.code).toBe('FORBIDDEN')
  })

  it('mapea (U0001, draft_already_confirmed) a 409 con codigo propio', () => {
    const error = translate(errorDePostgres('U0001', 'draft_already_confirmed: ya se confirmó'))
    expect(error?.status).toBe(409)
    expect(error?.code).toBe('INCIDENT_DRAFT_ALREADY_CONFIRMED')
  })

  it('mapea (U0001, draft_not_pending) y (U0001, draft_expired) al mismo 409', () => {
    expect(translate(errorDePostgres('U0001', 'draft_not_pending'))?.code).toBe(
      'INCIDENT_DRAFT_NOT_PENDING',
    )
    expect(translate(errorDePostgres('U0001', 'draft_expired'))?.code).toBe(
      'INCIDENT_DRAFT_NOT_PENDING',
    )
  })

  it('mapea (22023, draft_content_invalid) a un 400', () => {
    const error = translate(errorDePostgres('22023', 'draft_content_invalid: el título es corto'))
    expect(error?.status).toBe(400)
    expect(error?.code).toBe('VALIDATION_ERROR')
  })

  it('mapea la falta de contexto de usuario a un 401', () => {
    expect(translate(errorDePostgres('42501', 'sin contexto de usuario'))?.status).toBe(401)
  })

  it('un U0001 SIN su sentinel NO se convierte en 409', () => {
    expect(translate(errorDePostgres('U0001', 'un conflicto cualquiera'))).toBeNull()
  })

  it('un sentinel SIN su errcode no se convierte en el error de negocio', () => {
    const error = translate(errorDePostgres('23514', 'draft_not_found: violates check constraint'))
    expect(error?.status).toBe(400)
    expect(error?.code).toBe('VALIDATION_ERROR')
  })

  it('un 23505 sin sentinel es un conflicto', () => {
    expect(translate(errorDePostgres('23505', 'duplicate key value'))?.status).toBe(409)
  })

  it('un 22P02 es un 400 y no un 500', () => {
    expect(translate(errorDePostgres('22P02', 'invalid input syntax for type uuid'))?.status).toBe(
      400,
    )
  })

  it('devuelve null si el error no viene de PostgreSQL', () => {
    expect(translate(new Error('algo'))).toBeNull()
    expect(translate('texto')).toBeNull()
    expect(translate(null)).toBeNull()
  })
})

describe('ejecuta', () => {
  it('devuelve el valor si todo va bien', async () => {
    await expect(ejecuta(async () => 7)).resolves.toBe(7)
  })

  it('traduce un error de base de datos', async () => {
    await expect(
      ejecuta(async () => {
        throw errorDePostgres('P0002', 'draft_not_found: no existe')
      }),
    ).rejects.toMatchObject({ status: 404, code: 'INCIDENT_DRAFT_NOT_FOUND' })
  })

  it('traduce un LLMProviderError a 502 AI_PROVIDER_ERROR', async () => {
    await expect(
      ejecuta(async () => {
        throw new LLMProviderError('timeout')
      }),
    ).rejects.toMatchObject({ status: 502, code: 'AI_PROVIDER_ERROR' })
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
