// ---------------------------------------------------------------------------
// Token de sesion MCP (M-3).
//
// El adaptador MCP no puede reutilizar el access token de la API: aquel se emite
// para navegar por la web. En su lugar, un endpoint autenticado normal
// (`POST /api/v1/mcp/sessions`) Canjea la sesion del usuario por un token propio
// de MCP, con `audience: 'mcp'`, que fija de una vez:
//
//   - quien es (`sub`),
//   - en que comunidad trabaja (`cid`),
//   - con que rol (`role`),
//   - y una marca de sesion (`ver`) para auditoria.
//
// Que la comunidad vaya DENTRO del token es lo que hace innecesario pasarla como
// argumento de una tool (M-5): un cliente externo no puede pedir "la comunidad
// de al lado" porque no tiene donde escribirla.
//
// El token es de vida corta (`MCP_SESSION_TTL_SECONDS`). Ademas, cada peticion
// MCP vuelve a comprobar la pertenencia contra la base de datos, de modo que
// sacar a alguien de la comunidad lo deja fuera sin esperar a que caduque.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { tokenExpired, unauthorized } from '../http/errors.js'
import type { CommunityRole } from '../ai/types.js'

const ALGORITHM = 'HS256' as const
export const MCP_AUDIENCE = 'mcp'

export type McpSessionPayload = {
  userId: string
  communityId: string
  role: CommunityRole
  sessionId: string
}

export function signMcpSessionToken(input: { userId: string; communityId: string; role: CommunityRole }): string {
  return jwt.sign({ cid: input.communityId, role: input.role, ver: randomUUID() }, env.JWT_SECRET, {
    algorithm: ALGORITHM,
    audience: 'mcp',
    subject: input.userId,
    expiresIn: env.MCP_SESSION_TTL_SECONDS,
  })
}

export function verifyMcpSessionToken(token: string): McpSessionPayload {
  const decoded = (() => {
    try {
      return jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITHM], audience: 'mcp' })
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) throw tokenExpired()
      throw unauthorized('Sesión MCP no válida.')
    }
  })()

  if (typeof decoded === 'string') {
    throw unauthorized('Token MCP con formato inesperado.')
  }

  const { sub, cid, role, ver } = decoded as Record<string, unknown>

  if (
    typeof sub !== 'string' ||
    typeof cid !== 'string' ||
    typeof role !== 'string' ||
    typeof ver !== 'string'
  ) {
    throw unauthorized('Token MCP incompleto.')
  }

  return { userId: sub, communityId: cid, role: role as CommunityRole, sessionId: ver }
}

/** La vida del token en segundos, para que el endpoint la pueda devolver. */
export function mcpSessionTtlSeconds(): number {
  return env.MCP_SESSION_TTL_SECONDS
}

/** Un id de sesion MCP nuevo (para el `ver` del token de stdio). */
export function newMcpSessionId(): string {
  return randomUUID()
}
