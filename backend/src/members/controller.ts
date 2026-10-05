// ---------------------------------------------------------------------------
// Controller de miembros e invitaciones.
//
// Su unico trabajo es traducir HTTP a llamadas al servicio y volver. No decide
// nada: si aparece una condicion de negocio aqui, es que esta en el sitio
// equivocado.
//
// En concreto, este archivo NO sabe quien puede invitar ni quien puede cambiar un
// rol. Eso lo deciden `requireCommunityRole('ADMIN')` y el servicio. Lo unico que
// se comprueba aqui es la FORMA de lo que llega, que es una preocupacion de HTTP: los
// UUID de ruta y el esquema del cuerpo.
//
// `routeParam` + el mismo `parse` que usan los demas modulos, y no una lectura
// directa de `req.params`: los tipos de Express 5 tipan `req.params` como
// `string | string[]`, y propagar ese tipo por todo el archivo no ayuda a nadie.
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express'
import { badRequest } from '../http/errors.js'
import { created, noContent, ok } from '../http/envelope.js'
import { formatIssues } from '../auth/validators.js'
import type { ZodType } from 'zod'
import * as service from './service.js'
import { inviteSchema, patchMemberSchema, redeemSchema, uuidSchema } from './validators.js'
import { routeParam } from '../auth/middleware.js'

function parse<T>(schema: ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload)

  if (!result.success) {
    throw badRequest('Los datos enviados no son válidos.', formatIssues(result.error))
  }

  return result.data
}

/**
 * Un UUID de ruta, o un 400 que lo diga (C-9).
 *
 * Un `:memberId` que no es un UUID no es una peticion sin permiso: es una peticion
 * mal formada, y por eso 400 y no 403. Se comprueba aqui, antes de abrir
 * transaccion, porque un `::uuid` sobre texto invalido revienta con 22P02.
 */
function uuidParam(req: Request, name: string): string {
  return parse(uuidSchema, routeParam(req, name))
}

/** El `userId` y el rol ya los ha puesto el middleware. Si no, no deberia estar aqui. */
function actor(req: Request): { userId: string } {
  if (!req.auth) {
    throw badRequest('Petición sin sesión.')
  }

  return { userId: req.auth.userId }
}

// ---------------------------------------------------------------------------
// Miembros
// ---------------------------------------------------------------------------

/**
 * `GET /communities/:communityId/members`
 *
 * De cualquier miembro de la comunidad. El `role` de `req.community` no se mira
 * aqui: lo decide el guard de la ruta, que es el unico sitio donde se decide.
 */
export async function listMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId } = actor(req)
    const communityId = uuidParam(req, 'communityId')

    ok(res, await service.listMembers(userId, communityId))
  } catch (error) {
    next(error)
  }
}

/** `GET /communities/:communityId/members/:memberId` */
export async function getMember(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId } = actor(req)
    const communityId = uuidParam(req, 'communityId')
    const memberId = uuidParam(req, 'memberId')

    ok(res, await service.getMember(userId, communityId, memberId))
  } catch (error) {
    next(error)
  }
}

/**
 * `PATCH /communities/:communityId/members/:memberId`
 *
 * El cuerpo lo filtra `patchMemberSchema`, que exige `role` XOR `status`. El
 * servicio devuelve la fila ya actualizada, asi que la respuesta es el estado
 * real y no una confirmacion de que la escritura se lanzo.
 */
export async function patchMember(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId } = actor(req)
    const communityId = uuidParam(req, 'communityId')
    const memberId = uuidParam(req, 'memberId')
    const input = parse(patchMemberSchema, req.body)

    ok(res, await service.patchMember(userId, communityId, memberId, input))
  } catch (error) {
    next(error)
  }
}

// ---------------------------------------------------------------------------
// Invitaciones
// ---------------------------------------------------------------------------

/**
 * `POST /communities/:communityId/invitations`
 *
 * El codigo en claro sale UNICAMENTE aqui. Va despues del 201 y no en lugar de
 * el, como el `Location`: es informacion extra, no sustituta de la respuesta, que
 * ademas lleva la invitacion completa para no obligar al cliente a una segunda
 * peticion.
 */
export async function createInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId } = actor(req)
    const communityId = uuidParam(req, 'communityId')
    const input = parse(inviteSchema, req.body)

    const invitation = await service.createInvitation(userId, communityId, input)

    res.setHeader('Location', `/api/v1/communities/${communityId}/invitations/${invitation.id}`)
    created(res, invitation)
  } catch (error) {
    next(error)
  }
}

/** `GET /communities/:communityId/invitations`, incluidas las ya usadas (M-11). */
export async function listInvitations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId } = actor(req)
    const communityId = uuidParam(req, 'communityId')

    ok(res, await service.listInvitations(userId, communityId))
  } catch (error) {
    next(error)
  }
}

/**
 * `DELETE /communities/:communityId/invitations/:invitationId`
 *
 * 204 sin cuerpo, no 200 con `null`: anular no deja recurso que leer, y el
 * envelope prohibe `data: null` para que nadie lo lea como un fallo.
 */
export async function deleteInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId } = actor(req)
    const communityId = uuidParam(req, 'communityId')
    const invitationId = uuidParam(req, 'invitationId')

    await service.deleteInvitation(userId, communityId, invitationId)

    noContent(res)
  } catch (error) {
    next(error)
  }
}

// ---------------------------------------------------------------------------
// Canje
// ---------------------------------------------------------------------------

/**
 * `POST /invitations/redeem`
 *
 * Es la unica ruta de este bloque que NO lleva `requireCommunity`, y con razon: al
 * canjear no se sabe todavia en que comunidad se va a entrar. La comunidad la
 * decide el codigo, dentro de la funcion. Poner `requireCommunity` aqui obligaria
 * al vecino a tener ya una pertenencia, que es justo lo que va a conseguir.
 *
 * El `Location` apunta a la membresia creada. Y con el nombre del rol y el estado
 * seria mejor, pero la funcion no los devuelve (siempre `NEIGHBOR` y `ACTIVE`,
 * M-9) y quien quiera verlos tiene `GET /members/:memberId`.
 */
export async function redeemInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId } = actor(req)
    const input = parse(redeemSchema, req.body)

    const resultado = await service.redeemInvitation(userId, input)

    res.setHeader(
      'Location',
      `/api/v1/communities/${resultado.communityId}/members/${resultado.memberId}`,
    )
    created(res, resultado)
  } catch (error) {
    next(error)
  }
}