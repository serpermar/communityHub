// ---------------------------------------------------------------------------
// Controller del dashboard.
//
// Reparte HTTP y valida la FORMA de la query; no decide negocio. La
// autorizacion esta en `app_community_dashboard()` (02n) con el chequeo grueso
// de `requireCommunity()` en el router.
//
// El endpoint no tiene cuerpo: un POST con cuerpo no existe (solo se monta GET).
// La `communityId` de la URL la valida `requireCommunity()` (C-9) antes de
// tocar la base de datos, asi que aqui se lee de `req.community`.
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express'
import { badRequest } from '../http/errors.js'
import { ok } from '../http/envelope.js'
import { formatIssues } from '../auth/validators.js'
import type { ZodType } from 'zod'
import * as service from './service.js'
import { dashboardQuerySchema } from './validators.js'

function parse<T>(schema: ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload)

  if (!result.success) {
    throw badRequest('Los datos enviados no son válidos.', formatIssues(result.error))
  }

  return result.data
}

/** `GET /communities/:communityId/dashboard?from=&to=` */
export async function getDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.auth) {
      throw badRequest('Petición sin sesión.')
    }

    if (!req.community) {
      throw badRequest('Petición sin contexto de comunidad.')
    }

    const query = parse(dashboardQuerySchema, req.query)

    ok(res, await service.getDashboard(req.auth.userId, req.community.communityId, query))
  } catch (error) {
    next(error)
  }
}
