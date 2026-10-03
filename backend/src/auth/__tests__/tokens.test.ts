// ---------------------------------------------------------------------------
// Tokens: access JWT y refresh opaco.
//
// Cubre los criterios 3, 4, 5 y 7 de la spec 01 (seccion 10, Seguridad).
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import jwt from 'jsonwebtoken'
import { env } from '../../config/env.js'
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from '../tokens.js'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'

describe('signAccessToken / verifyAccessToken', () => {
  it('firma y verifica un token válido', () => {
    const token = signAccessToken({ userId: USER_ID, role: 'NEIGHBOR', sessionId: SESSION_ID })

    const payload = verifyAccessToken(token)

    expect(payload.sub).toBe(USER_ID)
    expect(payload.role).toBe('NEIGHBOR')
    // `ver` es el id de la sesión: es lo que permite que el logout invalide el
    // access token sin esperar a que expire.
    expect(payload.ver).toBe(SESSION_ID)
  })

  it('no lleva email ni nombre en el payload', () => {
    const token = signAccessToken({ userId: USER_ID, role: 'NEIGHBOR', sessionId: SESSION_ID })
    const payload = jwt.decode(token) as Record<string, unknown>

    // El access token viaja en cada petición: por proxies, logs del navegador y
    // cachés intermedias. Cuanto menos lleve, menos se filtra.
    expect(payload.email).toBeUndefined()
    expect(payload.full_name).toBeUndefined()
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'role', 'sub', 'ver'])
  })

  it('rechaza una firma inválida', () => {
    // Criterio 3. Se firma con otra clave: la estructura es correcta y solo la
    // firma no cuadra.
    const forged = jwt.sign({ role: 'ADMIN', ver: SESSION_ID }, 'otra-clave-de-32-caracteres-minimo', {
      algorithm: 'HS256',
      subject: USER_ID,
      expiresIn: 900,
    })

    expect(() => verifyAccessToken(forged)).toThrow()
  })

  it('rechaza alg: none', () => {
    // Criterio 4. El ataque clásico: un token sin firma que la librería acepta
    // como "no verificado" y por tanto válido. Solo se cierra fijando la lista
    // de algoritmos admitidos en verify.
    const noneAlg = jwt.sign({ role: 'ADMIN', ver: SESSION_ID }, '', {
      algorithm: 'none',
      subject: USER_ID,
      expiresIn: 900,
    })

    expect(() => verifyAccessToken(noneAlg)).toThrow()
  })

  it('rechaza un token expirado', () => {
    // Criterio 5.
    const expired = jwt.sign({ role: 'NEIGHBOR', ver: SESSION_ID }, env.JWT_SECRET, {
      algorithm: 'HS256',
      subject: USER_ID,
      expiresIn: -10,
    })

    expect(() => verifyAccessToken(expired)).toThrow(/caducado/i)
  })

  it('rechaza un token sin los claims mínimos', () => {
    const incomplete = jwt.sign({ role: 'NEIGHBOR' }, env.JWT_SECRET, {
      algorithm: 'HS256',
      subject: USER_ID,
      expiresIn: 900,
    })

    expect(() => verifyAccessToken(incomplete)).toThrow()
  })

  it('expira en el tiempo configurado', () => {
    const token = signAccessToken({ userId: USER_ID, role: 'NEIGHBOR', sessionId: SESSION_ID })
    const payload = jwt.decode(token) as { iat: number; exp: number }

    expect(payload.exp - payload.iat).toBe(env.ACCESS_TOKEN_TTL_SECONDS)
  })
})

describe('refresh tokens', () => {
  it('genera tokens aleatorios distintos', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateRefreshToken()))

    expect(tokens.size).toBe(50)
  })

  it('usa 48 bytes de entropía en base64url', () => {
    // 48 bytes -> 64 caracteres en base64url. Es lo que hace el token
    // imposible de adivinar, y por eso no necesita ser un JWT.
    expect(generateRefreshToken()).toHaveLength(64)
    expect(generateRefreshToken()).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('hashea de forma determinista, y nunca guarda el token en claro', () => {
    const token = generateRefreshToken()
    const hash = hashRefreshToken(token)

    expect(hashRefreshToken(token)).toBe(hash)
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]+$/)
    expect(hash).not.toBe(token)
    expect(hash).not.toContain(token)
  })
})