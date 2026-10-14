// ---------------------------------------------------------------------------
// Middleware del bloque de IA.
//
//   - `requireChatSession`: la sesion existe y es del actor, o 404. La politica
//     `ai_sessions_own` ya filtra por dueño; leer 0 filas es el 404 (AI-7). Se
//     usa en las dos rutas de sesion (`messages` y `DELETE`).
//
//   - `requireDraft`: valida que el id tenga forma de UUID. NO comprueba
//     propiedad: `app_runtime` no tiene `select` sobre `incident_drafts` a
//     proposito, asi que la propiedad la resuelve `app_confirm_incident_draft`
//     dentro de su transaccion (AI-14). Aqui solo se evita abrir una transaccion
//     con un `::uuid` invalido (22P02).
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express'
import { badRequest } from '../http/errors.js'
import { routeParam } from '../auth/middleware.js'
import { withContext } from '../context.js'
import { chatSessionNotFound } from './errors.js'
import * as repo from './repository.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ai?: {
        sessionId?: string
      }
    }
  }
}

/** Exige que `:id` sea una sesion de chat del actor. */
export function requireChatSession(param = 'id') {
  return async function chatSessionGuard(req: Request, _res: Response, next: NextFunction): Promise<void> {
    if (!req.auth) throw badRequest('Petición sin sesión.')

    const sessionId = routeParam(req, param)

    if (!UUID_RE.test(sessionId)) {
      throw badRequest(`El parámetro ${param} debe ser un UUID.`)
    }

    const session = await withContext({ userId: req.auth.userId, communityId: null }, (tx) =>
      repo.findSessionOwn(tx, sessionId),
    )

    if (!session) throw chatSessionNotFound()

    req.ai = { sessionId }
    next()
  }
}

/** Exige que `:id` tenga forma de UUID. La propiedad la decide la funcion SQL. */
export function requireDraft(param = 'id') {
  return function draftGuard(req: Request, _res: Response, next: NextFunction): void {
    if (!req.auth) throw badRequest('Petición sin sesión.')

    const draftId = routeParam(req, param)

    if (!UUID_RE.test(draftId)) {
      throw badRequest(`El parámetro ${param} debe ser un UUID.`)
    }

    next()
  }
}
