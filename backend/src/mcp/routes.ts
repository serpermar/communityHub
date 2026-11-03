// (cabecera original sin cambios)

import { Router, type NextFunction, type Request, type Response } from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { AppError, badRequest, forbidden, unauthorized } from '../http/errors.js'
import { requireAuth } from '../auth/middleware.js'
import { env } from '../config/env.js'
import { roleInCommunity } from '../ai/service.js'
import { buildMcpServer } from './server.js'
import {
  signMcpSessionToken,
  verifyMcpSessionToken,
  mcpSessionTtlSeconds,
  type McpSessionPayload,
} from './session.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      mcp?: McpSessionPayload
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
    await transport.handleRequest(
      req as unknown as import('node:http').IncomingMessage,
      res as unknown as import('node:http').ServerResponse,
      req.body,
    )
  } catch (error) {
    next(error)
  }
}

export async function createSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
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

  /**
   * @swagger
   * /api/v1/mcp/sessions:
   *   post:
   *     summary: Canjear la sesión por un token MCP
   *     description: |
   *       Emite un token MCP (JWT con `audience: 'mcp'`) para la comunidad
   *       indicada. El rol se lee de la base de datos, nunca del cuerpo.
   *     tags: [AI]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [communityId]
   *             properties:
   *               communityId: { type: string, format: uuid }
   *     responses:
   *       201:
   *         description: Token MCP emitido.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/McpSession' }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       403: { $ref: '#/components/responses/Forbidden' }
   */
  router.post('/sessions', requireAuth, createSession)

  /**
   * @swagger
   * /api/v1/mcp:
   *   post:
   *     summary: Endpoint JSON-RPC del servidor MCP
   *     description: |
   *       Exige token MCP (no el access token normal). Cada petición vuelve a
   *       comprobar la pertenencia a la comunidad del token, así que sacar a
   *       alguien de la comunidad corta su acceso al instante. Si
   *       `MCP_ENABLED=false`, responde 404 `MCP_DISABLED`.
   *     tags: [AI]
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { type: object, additionalProperties: true }
   *     responses:
   *       200:
   *         description: Respuesta JSON-RPC.
   *         content:
   *           application/json:
   *             schema: { type: object, additionalProperties: true }
   *       400: { $ref: '#/components/responses/Validation' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   *       404:
   *         description: MCP_DISABLED
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/Error' }
   *       429: { $ref: '#/components/responses/RateLimited' }
   */
  router.post('/', requireMcpToken, handleMcp)

  /**
   * @swagger
   * /api/v1/mcp:
   *   get:
   *     summary: Método no permitido
   *     description: En modo stateless no hay stream GET que abrir. Devuelve 405.
   *     tags: [AI]
   *     responses:
   *       405:
   *         description: Método no permitido.
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/Error' }
   */
  router.get('/', (_req, res) => {
    res.status(405).json({ error: { code: 'VALIDATION_ERROR', message: 'Método no permitido.' } })
  })

  return router
}
