// ---------------------------------------------------------------------------
// Rutas del adaptador MCP (M-2, M-3).
//
//   POST /api/v1/mcp/sessions  -> canjea la sesion del usuario por un token MCP
//   POST /api/v1/mcp           -> endpoint MCP (JSON-RPC)
//
// El endpoint MCP no usa el access token de la API: exige un token de sesion MCP
// con `audience: 'mcp'` (M-3). Cada peticion vuelve a comprobar la pertenencia
// contra la base de datos, de modo que sacar a alguien de la comunidad corta su
// acceso al instante.
// ---------------------------------------------------------------------------

import { Router, type NextFunction, type Request, type Response } from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { AppError, badRequest, forbidden, unauthorized } from '../http/errors.js'
import { requireAuth } from '../auth/middleware.js'
import { env } from '../config/env.js'
import { roleInCommunity } from '../ai/service.js'
import { buildMcpServer } from './server.js'
import { signMcpSessionToken, verifyMcpSessionToken, mcpSessionTtlSeconds, type McpSessionPayload } from './session.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      mcp?: McpSessionPayload
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Exige un token de sesion MCP valido.
 *
 * Ademas de verificar firma y caducidad, vuelve a resolver el rol del actor en la
 * comunidad del token. Es lo que hace revocable una sesion MCP sin lista de
 * revocacion: quitar a alguien de la comunidad (o cambiarle el rol) surte efecto
 * en la siguiente peticion.
 */
async function requireMcpToken(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!env.MCP_ENABLED) {
    throw new AppError(404, 'MCP_DISABLED', 'El servidor MCP está desactivado.')
  }

  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    throw unauthorized('Falta la cabecera Authorization del token MCP.')
  }

  const payload = verifyMcpSessionToken(header.slice('Bearer '.length).trim())

  const role = await roleInCommunity(payload.userId, payload.communityId)
  if (!role) {
    throw unauthorized('La sesión MCP ya no es válida.', 'TOKEN_REVOKED')
  }

  req.mcp = { ...payload, role }
  next()
}

/** El endpoint MCP: un servidor y un transporte por peticion (stateless). */
export async function handleMcp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const session = req.mcp as McpSessionPayload

    const server = buildMcpServer(session)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })

    res.on('close', () => {
      void transport.close()
      void server.close()
    })

    await server.connect(transport)

    // El SDK tipa `req` como `IncomingMessage` con un `auth` propio (OAuth). El
    // `auth` de Express (sesion del usuario) no encaja, y no hace falta: el actor
    // ya viaja en `req.mcp`. Se convierte a la forma que el transporte espera.
    await transport.handleRequest(
      req as unknown as import('node:http').IncomingMessage,
      res as unknown as import('node:http').ServerResponse,
      req.body,
    )
  } catch (error) {
    next(error)
  }
}

/**
 * Canjea la sesion normal por un token MCP.
 *
 * El usuario debe ser miembro de la comunidad; el rol sale de la base de datos,
 * nunca del cuerpo.
 */
export async function createSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.auth?.userId
    if (!userId) throw unauthorized()

    const communityId = (req.body as { communityId?: unknown })?.communityId
    if (typeof communityId !== 'string' || !UUID_RE.test(communityId)) {
      throw badRequest('communityId debe ser un UUID.')
    }

    const role = await roleInCommunity(userId, communityId)
    if (!role) throw forbidden('No perteneces a esta comunidad.')

    const token = signMcpSessionToken({ userId, communityId, role })
    const expiresAt = new Date(Date.now() + mcpSessionTtlSeconds() * 1000).toISOString()

    res.status(201).json({ data: { token, communityId, role, expiresAt } })
  } catch (error) {
    next(error)
  }
}

export function createMcpRouter(): import('express').Router {
  const router = Router()

  router.post('/sessions', requireAuth, createSession)
  router.post('/', requireMcpToken, handleMcp)

  // En modo stateless no hay stream GET que abrir; se responde 405 con el
  // envelope de error habitual.
  router.get('/', (_req, res) => {
    res.status(405).json({ error: { code: 'VALIDATION_ERROR', message: 'Método no permitido.' } })
  })

  return router
}
