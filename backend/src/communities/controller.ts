// ---------------------------------------------------------------------------
// Controller de comunidades.
//
// Su unico trabajo es traducir HTTP a llamadas al servicio y volver. No decide
// nada: si aparece una condicion de negocio aqui, es que esta en el sitio
// equivocado.
//
// En concreto, este archivo NO sabe quien puede crear una comunidad ni quien
// puede editarla. Eso lo deciden `requireGlobalAdmin` y `requireCommunityRole`, y
// el servicio.
//
// Lo unico que se comprueba en este archivo es la forma del cuerpo, que es una
// preocupacion de HTTP. El permiso no.
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express'
import { badRequest } from '../http/errors.js'
import { created, ok } from '../http/envelope.js'
import { formatIssues } from '../auth/validators.js'
import type { ZodType } from 'zod'
import * as service from './service.js'
import { createCommunitySchema, updateCommunitySchema } from './validators.js'
import { routeParam } from '../auth/middleware.js'

function parse<T>(schema: ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload)

  if (!result.success) {
    throw badRequest('Los datos enviados no son válidos.', formatIssues(result.error))
  }

  return result.data
}

/** El `userId` y el rol ya los ha puesto el middleware. Si no, no deberia estar aqui. */
function actor(req: Request): { userId: string } {
  if (!req.auth) {
    throw badRequest('Petición sin sesión.')
  }
  return { userId: req.auth.userId }
}

export async function list(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId } = actor(req)
    ok(res, await service.listMine(userId))
  } catch (error) {
    next(error)
  }
}

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId } = actor(req)
    const input = parse(createCommunitySchema, req.body)
    const community = await service.create(userId, input)

    // La cabecera `Location` dice donde esta lo recien creado. Va despues del
    // 201 y no en lugar de el: es informacion extra, no sustituta de la
    // respuesta, que sigue llevando el recurso completo para no obligar al
    // cliente a hacer una segunda peticion.
    res.setHeader('Location', `/api/v1/communities/${community.id}`)
    created(res, community)
  } catch (error) {
    next(error)
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId } = actor(req)
    const communityId = routeParam(req, 'communityId')
    ok(res, await service.getOne(userId, communityId, req.community?.role ?? 'NEIGHBOR'))
  } catch (error) {
    next(error)
  }
}

export async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId } = actor(req)
    const communityId = routeParam(req, 'communityId')
    const input = parse(updateCommunitySchema, req.body)
    ok(res, await service.update(userId, communityId, req.community?.role ?? 'NEIGHBOR', input))
  } catch (error) {
    next(error)
  }
}
