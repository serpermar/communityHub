// ---------------------------------------------------------------------------
// Tokens: access JWT y refresh opaco.
//
// Son dos cosas distintas con propositos distintos, y por eso se emiten de
// formas distintas.
//
// Access token: JWT HS256, 15 minutos, payload minimo. Va en el header
// Authorization en cada peticion, asi que viaja por proxies, logs y cachés de
// intermediates. Por eso no lleva email ni nombre: los datos del usuario se
// piden a la base de datos cuando hacen falta. El payload lleva `ver` (el id de
// la sesion), que es lo que permite que cerrar sesion invalide el token sin
// esperar a que expire.
//
// Refresh token: opaco, no JWT, 30 dias. Va en cookie httpOnly. Al ser opaco se
// puede revocar consultando la tabla de sesiones; un JWT de refresh seguiria
// siendo valido hasta expirar, porque no existe lista de revocacion. En la base
// de datos solo se guarda su hash SHA-256, de modo que leer la tabla no permite
// suplantar a nadie.
// ---------------------------------------------------------------------------

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { tokenExpired, tokenRevoked, unauthorized } from '../http/errors.js'

const ALGORITHM = 'HS256' as const

export type AccessTokenPayload = {
  /** id del usuario (uuid) */
  sub: string
  /** rol global de plataforma */
  role: string
  /** id de la sesion: permite invalidar el access token al cerrar sesion */
  ver: string
}

export function signAccessToken(input: { userId: string; role: string; sessionId: string }): string {
  return jwt.sign({ role: input.role, ver: input.sessionId }, env.JWT_SECRET, {
    algorithm: ALGORITHM,
    subject: input.userId,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  })
}

/**
 * Verifica firma, expiration y algoritmo.
 *
 * `algorithms: [HS256]` no es opcional. Sin esa lista, la libreria acepta el
 * token que le manden: un atacante puede enviar `alg: none` (firma vacia, la
 * libreria lo acepta como "sin verificar") o cambiarlo a RS256 y exploiting
 * la confusion de algoritmos. Fijar la lista de algoritmos admitidos cierra las
 * dos.
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  // La decodificacion va FUERA del try. Si estuviera dentro, los `unauthorized`
  // de abajo se capturarian a si mismos y saldrian convertidos en el error
  // generico del catch, que es lo mismo pero con el mensaje equivocado: el
  // codigo de distincion entre "token incompleto" y "firma invalida" nunca
  // llegaria a verse.
  const decoded = (() => {
    try {
      return jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITHM] })
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) throw tokenExpired()
      // Solo se distinguen los dos casos que la spec define con codigo propio; el
      // resto (firma invalida, algoritmo incorrecto, token malformado) es un 401
      // generico, porque detallar por que falla el token ayuda a quien prueba.
      throw unauthorized('Sesión no válida.', 'UNAUTHORIZED')
    }
  })()

  if (typeof decoded === 'string') {
    throw unauthorized('Token con formato inesperado.')
  }

  const { sub, role, ver } = decoded as Record<string, unknown>

  if (typeof sub !== 'string' || typeof ver !== 'string' || typeof role !== 'string') {
    throw unauthorized('Token incompleto.')
  }

  return { sub, role, ver }
}

// --- Refresh tokens ---------------------------------------------------------

/** 48 bytes aleatorios en base64url. Es el token que ve el cliente. */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url')
}

/**
 * SHA-256 del token, que es lo unico que se guarda en la base de datos.
 *
 * No es un hash de contrasena y no necesita argon2: el token ya tiene 384 bits
 * de entropia, asi que no es adivinable. Lo que protege es que una lectura de la
 * tabla `sessions` no sirva para autenticarse.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function newFamilyId(): string {
  return randomUUID()
}