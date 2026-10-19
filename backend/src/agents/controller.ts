// ---------------------------------------------------------------------------
// Controller de los agentes (M-10).
//
// Dos rutas: listar los agentes de runtime y ejecutar uno. El reparto es el de
// siempre: valida con zod, llama al service con el `userId` de `requireAuth` y
// devuelve el envelope.
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express'
import { badRequest } from '../http/errors.js'
import { formatIssues } from '../auth/validators.js'
import { ok } from '../http/envelope.js'
import { routeParam } from '../auth/middleware.js'
import { runtimeAgents } from './registry.js'
import { runAgent } from './runtime.js'
import { runAgentBodySchema } from './validators.js'

function actor(req: Request): string {
  if (!req.auth) throw badRequest('Petición sin sesión.')
  return req.auth.userId
}

export async function listAgents(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    actor(req)
    ok(
      res,
      runtimeAgents().map((agent) => ({
        name: agent.name,
        title: agent.title,
        description: agent.description,
        roles: agent.roles,
        skills: agent.skills,
      })),
    )
  } catch (error) {
    next(error)
  }
}

export async function runAgentHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = actor(req)
    const name = routeParam(req, 'name')
    const parsed = runAgentBodySchema.safeParse(req.body)

    if (!parsed.success) {
      throw badRequest('Los datos enviados no son válidos.', formatIssues(parsed.error))
    }

    const result = await runAgent(userId, name, parsed.data.communityId, parsed.data.message)
    ok(res, result)
  } catch (error) {
    next(error)
  }
}
