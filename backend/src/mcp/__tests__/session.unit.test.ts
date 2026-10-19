// ---------------------------------------------------------------------------
// Token de sesion MCP (unitarios).
//
// Firma y verificacion, sin base de datos. La frontera que se prueba: un token
// de MCP no vale como token de otro tipo y viceversa (audience distinta).
// ---------------------------------------------------------------------------

import jwt from 'jsonwebtoken'
import { describe, expect, it } from 'vitest'
import { env } from '../../config/env.js'
import { AppError } from '../../http/errors.js'
import { signMcpSessionToken, verifyMcpSessionToken } from '../session.js'

const userId = '11111111-1111-4111-8111-111111111111'
const communityId = '22222222-2222-4222-8222-222222222222'

describe('token de sesion MCP', () => {
  it('firma y verifica, recuperando actor, comunidad y rol', () => {
    const token = signMcpSessionToken({ userId, communityId, role: 'ADMIN' })
    const payload = verifyMcpSessionToken(token)
    expect(payload).toMatchObject({ userId, communityId, role: 'ADMIN' })
    expect(payload.sessionId).toMatch(/\S/)
  })

  it('rechaza un token sin el audience de MCP', () => {
    const token = jwt.sign({ cid: communityId, role: 'ADMIN', ver: 'x' }, env.JWT_SECRET, {
      algorithm: 'HS256',
      subject: userId,
      expiresIn: 3600,
    })
    expect(() => verifyMcpSessionToken(token)).toThrow(AppError)
  })

  it('rechaza un token manipulado', () => {
    const token = signMcpSessionToken({ userId, communityId, role: 'NEIGHBOR' })
    expect(() => verifyMcpSessionToken(`${token}tampered`)).toThrow(AppError)
  })
})
