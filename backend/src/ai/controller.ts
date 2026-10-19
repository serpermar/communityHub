// ---------------------------------------------------------------------------
// Controller de IA: reparto de rutas y serializacion de respuestas.
//
// El controller hace tres cosas y solo esas:
//
//   1. Valida la entrada con zod (cuerpos, query, params), devuelve 400 si falla.
//   2. Llama a `service.ts` con el `userId` que viene de `requireAuth`.
//   3. Traduce la salida a un envelope `{ data }` o delega el stream al service.
//
// El streaming SSE esta encapsulado aqui: cuando falla antes de emitir el primer
// evento devolvemos JSON (error middleware); cuando falla despues emitimos un
// evento `error` y cerramos el stream.
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express'
import { type ZodType } from 'zod'
import { badRequest } from '../http/errors.js'
import { formatIssues } from '../auth/validators.js'
import { created, noContent, ok } from '../http/envelope.js'
import { routeParam } from '../auth/middleware.js'
import * as service from './service.js'
import type { ChatEvent } from './assistant.js'
import {
  chatBodySchema,
  classifyBodySchema,
  confirmBodySchema,
  draftBodySchema,
  paginationQuerySchema,
  previewBodySchema,
  toolNameSchema,
  uuidSchema,
} from './validators.js'

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
} as const

function parse<T>(schema: ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload)
  if (!result.success) {
    throw badRequest('Los datos enviados no son válidos.', formatIssues(result.error))
  }
  return result.data
}

function actor(req: Request): string {
  if (!req.auth) throw badRequest('Petición sin sesión.')
  return req.auth.userId
}

// --- Chat (SSE) --------------------------------------------------------------

export async function chat(req: Request, res: Response, next: NextFunction): Promise<void> {
  let started = false

  const write = (event: ChatEvent): void => {
    if (!started) {
      res.writeHead(200, SSE_HEADERS)
      started = true
    }
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  }

  try {
    const userId = actor(req)
    const body = parse(chatBodySchema, req.body)

    await service.chat(userId, body, write)
    res.end()
  } catch (error: unknown) {
    if (!started) {
      next(error)
      return
    }

    const e = error as { code?: string; message?: string }
    try {
      res.write(
        `event: error\ndata: ${JSON.stringify({
          type: 'error',
          code: e.code ?? 'AI_PROVIDER_ERROR',
          message: e.message ?? 'El proveedor de IA falló.',
        })}\n\n`,
      )
    } finally {
      res.end()
    }
  }
}

// --- Sesiones ----------------------------------------------------------------

export async function listSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = actor(req)
    const query = parse(paginationQuerySchema, req.query)
    const result = await service.listSessions(userId, query)
    ok(res, result.items, result.meta)
  } catch (error) {
    next(error)
  }
}

export async function listMessages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = actor(req)
    const id = parse(uuidSchema, routeParam(req, 'id'))
    const query = parse(paginationQuerySchema, req.query)
    const result = await service.listMessages(userId, id, query)
    ok(res, result.items, result.meta)
  } catch (error) {
    next(error)
  }
}

export async function deleteSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = actor(req)
    const id = parse(uuidSchema, routeParam(req, 'id'))
    await service.deleteSession(userId, id)
    noContent(res)
  } catch (error) {
    next(error)
  }
}

// --- Incidencias IA ----------------------------------------------------------

export async function classify(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = actor(req)
    const body = parse(classifyBodySchema, req.body)
    const result = await service.classify(userId, body.communityId, body.description)
    ok(res, result.proposal)
  } catch (error) {
    next(error)
  }
}

export async function createDraft(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = actor(req)
    const body = parse(draftBodySchema, req.body)
    const draft = await service.createDraft(
      userId,
      body.communityId,
      body.description,
      body.proposal,
    )
    res.location(`/api/v1/ai/incidents/drafts/${draft.id}`)
    created(res, draft)
  } catch (error) {
    next(error)
  }
}

export async function confirmDraft(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = actor(req)
    const id = parse(uuidSchema, routeParam(req, 'id'))
    const body = parse(confirmBodySchema, req.body)
    const incident = await service.confirmDraft(userId, id, body)
    created(res, incident)
  } catch (error) {
    next(error)
  }
}

// --- Tools -------------------------------------------------------------------

export async function listTools(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = actor(req)
    const result = await service.listTools(userId)
    ok(res, result)
  } catch (error) {
    next(error)
  }
}

export async function previewTool(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = actor(req)
    const toolName = parse(toolNameSchema, routeParam(req, 'toolName'))
    const body = parse(previewBodySchema, req.body)
    const result = await service.previewTool(userId, toolName, body.communityId, body.args)
    ok(res, result)
  } catch (error) {
    next(error)
  }
}
