// ---------------------------------------------------------------------------
// Controller de votaciones.
//
// Reparte HTTP y valida la FORMA de lo que llega; no decide negocio. Toda la
// autorizacion esta en las funciones de SQL (02k), con el chequeo grueso de
// `requireCommunity()` / `requireCommunityRole('PRESIDENT','ADMIN')` para las
// rutas de comunidad y `requireVote()` para las de voto por id.
//
// Detalles propios del bloque:
//
//   - El alta responde 201 con `Location: /api/v1/votes/{id}` (spec 10 §7.4),
//     porque la API SI expone `GET /votes/:id`.
//   - `publish`, `close` y `results` no llevan cuerpo; `publish`/`close` pasan un
//     `.strict()` de objeto vacio para que mandar campos sea un 400 (no un 200
//     que los ignora).
//   - `results/export` es la excepcion al sobre `{ data }`: responde `text/csv`
//     con `Content-Disposition` (V-13), como la descarga de documentos (bloque
//     08). Se antepone un BOM UTF-8 para que Excel muestre bien las tildes.
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express'
import { badRequest } from '../http/errors.js'
import { created, ok } from '../http/envelope.js'
import { formatIssues } from '../auth/validators.js'
import type { ZodType } from 'zod'
import { routeParam } from '../auth/middleware.js'
import * as service from './service.js'
import {
  castVoteSchema,
  createVoteSchema,
  emptyBodySchema,
  updateVoteSchema,
  uuidSchema,
  votesQuerySchema,
} from './validators.js'

function parse<T>(schema: ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload)

  if (!result.success) {
    throw badRequest('Los datos enviados no son válidos.', formatIssues(result.error))
  }

  return result.data
}

/** Un UUID de ruta, o un 400 que lo diga (C-9). */
function uuidParam(req: Request, name: string): string {
  return parse(uuidSchema, routeParam(req, name))
}

/** Para las rutas con comunidad en la URL: `req.community` ya lo puso el middleware. */
function comunidadDeRuta(req: Request): { userId: string; communityId: string } {
  if (!req.auth) {
    throw badRequest('Petición sin sesión.')
  }

  if (!req.community) {
    throw badRequest('Petición sin contexto de comunidad.')
  }

  return { userId: req.auth.userId, communityId: req.community.communityId }
}

/** Para las rutas con la votacion en la URL: solo hace falta quién pide. */
function actor(req: Request): string {
  if (!req.auth) {
    throw badRequest('Petición sin sesión.')
  }

  return req.auth.userId
}

// ---------------------------------------------------------------------------
// Rutas con :communityId en la URL
// ---------------------------------------------------------------------------

/** `GET /communities/:communityId/votes?status=&page=&limit=` */
export async function listVotes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = comunidadDeRuta(req)
    const query = parse(votesQuerySchema, req.query)

    const resultado = await service.listVotes(userId, communityId, query)

    ok(res, resultado.items, resultado.meta)
  } catch (error) {
    next(error)
  }
}

/**
 * `POST /communities/:communityId/votes` (solo PRESIDENT/ADMIN).
 *
 * El rol lo pone `requireCommunityRole('PRESIDENT','ADMIN')` en la ruta (chequeo
 * grueso) y lo repite `app_create_vote()` dentro de la transaccion. El 201 lleva
 * `Location` con la votacion recien creada.
 */
export async function createVote(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = comunidadDeRuta(req)
    const input = parse(createVoteSchema, req.body)

    const votacion = await service.createVote(userId, communityId, input)

    res.location(`/api/v1/votes/${votacion.id}`)
    created(res, votacion)
  } catch (error) {
    next(error)
  }
}

// ---------------------------------------------------------------------------
// Rutas con :id de votacion
// ---------------------------------------------------------------------------

/** `GET /votes/:id`. `requireVote()` ya resolvio la visibilidad (V-5). */
export async function getVote(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = actor(req)
    const voteId = uuidParam(req, 'id')

    ok(res, await service.getVote(userId, voteId))
  } catch (error) {
    next(error)
  }
}

/**
 * `PATCH /votes/:id` (parcial, solo DRAFT, V-7).
 *
 * Sin guard de rol en la ruta: `app_update_vote()` decide el 404, el 403
 * (`vote_requires_leadership`) y el 409 (`vote_not_draft`).
 */
export async function updateVote(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = actor(req)
    const voteId = uuidParam(req, 'id')
    const input = parse(updateVoteSchema, req.body)

    ok(res, await service.updateVote(userId, voteId, input))
  } catch (error) {
    next(error)
  }
}

/** `POST /votes/:id/publish` (DRAFT -> OPEN). Sin cuerpo. El 409 lo decide la funcion. */
export async function publishVote(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = actor(req)
    const voteId = uuidParam(req, 'id')

    parse(emptyBodySchema, req.body ?? {})

    ok(res, await service.publishVote(userId, voteId))
  } catch (error) {
    next(error)
  }
}

/** `POST /votes/:id/close` (OPEN -> CLOSED). Sin cuerpo. El 409 lo decide la funcion. */
export async function closeVote(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = actor(req)
    const voteId = uuidParam(req, 'id')

    parse(emptyBodySchema, req.body ?? {})

    ok(res, await service.closeVote(userId, voteId))
  } catch (error) {
    next(error)
  }
}

/**
 * `POST /votes/:id/responses` (upsert de voto, V-11).
 *
 * Cuerpo `{ optionId }` y `.strict()`: mandar `userId`, `weight` o cualquier
 * otro campo es un 400. La ventana, el veto a PROVIDER y el "optionId es de esta
 * votacion" los decide `app_cast_vote()`.
 */
export async function castVote(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = actor(req)
    const voteId = uuidParam(req, 'id')
    const input = parse(castVoteSchema, req.body)

    ok(res, await service.castVote(userId, voteId, input))
  } catch (error) {
    next(error)
  }
}

/** `GET /votes/:id/results` (recuento agregado, V-2/V-12). */
export async function getResults(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = actor(req)
    const voteId = uuidParam(req, 'id')

    ok(res, await service.voteResults(userId, voteId))
  } catch (error) {
    next(error)
  }
}

/**
 * `GET /votes/:id/results/export` (V-13).
 *
 * `text/csv`, no JSON: rompe el sobre `{ data }` a proposito (como la descarga
 * de documentos, bloque 08). El BOM inicial es para que Excel reconozca el UTF-8.
 */
export async function exportResults(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = actor(req)
    const voteId = uuidParam(req, 'id')

    const { filename, csv } = await service.exportResults(userId, voteId)

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send('\uFEFF' + csv)
  } catch (error) {
    next(error)
  }
}
