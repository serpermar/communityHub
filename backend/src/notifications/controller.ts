// ---------------------------------------------------------------------------
// Controller de notificaciones (spec 14 §6).
//
// Reparte HTTP y valida la FORMA de lo que llega; no decide negocio. La
// autorizacion es la RLS `notifications_own`, no un middleware de rol: no hay
// `requireCommunity` porque las notificaciones son del USUARIO, no de una
// comunidad (NTF-3). Solo exigen `requireAuth`, montado en la ruta.
//
// El `:id` se valida aqui con `uuidSchema` antes de tocar la base de datos: un
// `::uuid` sobre texto invalido revienta con 22P02, y aunque se tradujese a 400
// llegaria tarde (C-9).
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express'
import { badRequest } from '../http/errors.js'
import { ok } from '../http/envelope.js'
import { formatIssues } from '../auth/validators.js'
import { routeParam } from '../auth/middleware.js'
import type { ZodType } from 'zod'
import * as service from './service.js'
import { listQuerySchema, uuidSchema } from './validators.js'

function parse<T>(schema: ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload)

  if (!result.success) {
    throw badRequest('Los datos enviados no son válidos.', formatIssues(result.error))
  }

  return result.data
}

function usuarioDeRuta(req: Request): string {
  if (!req.auth) {
    throw badRequest('Petición sin sesión.')
  }

  return req.auth.userId
}

/** `GET /api/v1/notifications?unread=&page=&limit=` */
export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = usuarioDeRuta(req)
    const query = parse(listQuerySchema, req.query)

    const page = await service.listNotifications(userId, query)

    ok(res, page.items, page.meta)
  } catch (error) {
    next(error)
  }
}

/** `GET /api/v1/notifications/unread-count` */
export async function unreadCount(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = usuarioDeRuta(req)

    ok(res, { count: await service.unreadCount(userId) })
  } catch (error) {
    next(error)
  }
}

/** `PATCH /api/v1/notifications/:id/read` */
export async function markRead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = usuarioDeRuta(req)
    const id = parse(uuidSchema, routeParam(req, 'id'))

    ok(res, await service.markRead(userId, id))
  } catch (error) {
    next(error)
  }
}

/** `POST /api/v1/notifications/read-all` */
export async function readAll(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = usuarioDeRuta(req)

    ok(res, { updated: await service.readAll(userId) })
  } catch (error) {
    next(error)
  }
}
