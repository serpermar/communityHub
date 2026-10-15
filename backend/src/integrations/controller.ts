// ---------------------------------------------------------------------------
// Controller de APIs externas.
//
// Su unico trabajo es traducir HTTP a llamadas al service y volver. No decide
// nada: quien puede llamar lo deciden los middleware de la ruta y el service.
//
// La unica linea que merece un comentario es la de `map`: el servicio siempre
// devuelve un `MapView` (nunca `null`), porque `location` sale de la base de
// datos aunque el proveedor falle (§6.4). El de `weather` si puede devolver
// `null`, y entonces `data` viaja como `null` con un `meta.reason`.
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express'
import { badRequest } from '../http/errors.js'
import { ok } from '../http/envelope.js'
import { routeParam } from '../auth/middleware.js'
import * as service from './service.js'

function actor(req: Request): { userId: string } {
  if (!req.auth) {
    throw badRequest('Petición sin sesión.')
  }
  return { userId: req.auth.userId }
}

export async function weather(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId } = actor(req)
    const communityId = routeParam(req, 'communityId')
    const { data, meta } = await service.getWeather(userId, communityId)
    ok(res, data, meta)
  } catch (error) {
    next(error)
  }
}

export async function map(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId } = actor(req)
    const communityId = routeParam(req, 'communityId')
    const { data, meta } = await service.getMap(userId, communityId)
    ok(res, data, meta)
  } catch (error) {
    next(error)
  }
}

export async function geocode(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId } = actor(req)
    const communityId = routeParam(req, 'communityId')
    ok(res, await service.geocode(userId, communityId, req.community?.role ?? null))
  } catch (error) {
    next(error)
  }
}
