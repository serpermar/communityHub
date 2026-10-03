// ---------------------------------------------------------------------------
// Middleware de autenticacion y de alcance de comunidad.
//
// `requireAuth` demuestra quien es el usuario. `requireCommunity` demuestra que
// ese usuario tiene algo que ver con esa comunidad concreta.
//
// La separacion es deliberada: `requireAuth` vale para todo lo que es "sabes
// quien eres" (perfil, sesiones) y `requireCommunity` para todo lo que es "y
// además estás dentro de esta comunidad". Un endpoint que solo necesite lo
// primero no debería exigir lo segundo, porque obligaría a un vecino a elegir
// comunidad para ver su perfil.
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express'
import { withContext } from '../context.js'
import { forbidden, unauthorized } from '../http/errors.js'
import { verifyAccessToken } from './tokens.js'
import * as repo from './repository.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: {
        userId: string
        role: string
        sessionId: string
      }
      community?: {
        communityId: string
        role: string
      }
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Lee un parametro de ruta como string.
 *
 * Los tipos de Express 5 tipan `req.params` como `string | string[]`, porque
 * admiten parametros repetidos. En la practica un `:communityId` nunca es un
 * array, asi que se toma el primer valor y se descarta el resto en lugar de
 * propagar un tipo inutil a todo lo que viene despues.
 */
export function routeParam(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name]
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

/**
 * Exige un access token valido.
 *
 * Tres comprobaciones, en este orden:
 *
 *   1. Firma, expiration y algoritmo del JWT.
 *   2. Que la sesion identificada por `ver` siga ACTIVE.
 *   3. Que la sesion sea de ese usuario.
 *
 * La segunda es la que hace que "salir" funcione de verdad. Sin ella, el logout
 * solo borraria la cookie y el access token seguiria valido hasta 15 minutos.
 * Con ella, la siguiente peticion da 401 al instante.
 *
 * Cuesta una consulta a la base de datos por peticion. Es el precio de que la
 * sesion sea revocable de verdad, y es la decision correcta: un token de 15
 * minutos que no se puede revocar no es una sesion revocable.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization

  if (!header?.startsWith('Bearer ')) {
    throw unauthorized('Falta la cabecera Authorization.')
  }

  const payload = verifyAccessToken(header.slice('Bearer '.length).trim())

  const session = await withContext({ userId: payload.sub, communityId: null }, (tx) =>
    repo.findSessionStatus(tx, payload.ver),
  )

  if (!session || session.status !== 'ACTIVE') {
    throw unauthorized('La sesión ya no es válida.', 'TOKEN_REVOKED')
  }

  // El token podria estar bien firmado y ser de otra persona si se mezclaran
  // sub y ver. Comprobarlo aqui evita dar acceso con un token manipulado.
  if (session.user_id !== payload.sub) {
    throw unauthorized('Sesión no válida.')
  }

  req.auth = { userId: payload.sub, role: payload.role, sessionId: payload.ver }
  next()
}

/**
 * Exige pertenencia activa a la comunidad de `:communityId`.
 *
 * El `communityId` de la URL es un dato del cliente y se trata como tal: se
 * valida contra la pertenencia real. Cambiar el id en la URL no da acceso a otra
 * comunidad, da un 403. Ese es el requisito de la seccion 9 del enunciado.
 *
 * El rol se resuelve con `app_role_in()`, que ya lee el contexto de RLS. No se
 * consulta `community_members` a mano, porque esa consulta pasaria por la misma
 * politica y seria redundante.
 */
export function requireCommunity(paramName = 'communityId') {
  return async function communityGuard(req: Request, _res: Response, next: NextFunction): Promise<void> {
    if (!req.auth) {
      throw unauthorized()
    }

    const communityId = routeParam(req, paramName)

    if (!UUID_RE.test(communityId)) {
      throw forbidden('Identificador de comunidad no válido.')
    }

    const rows: Array<{ role: string | null }> = await withContext(
      { userId: req.auth.userId, communityId },
      (tx) =>
        tx.$queryRaw<Array<{ role: string | null }>>`
          select app_role_in(${communityId}::uuid) as role
        `,
    )

    const role = rows[0]?.role ?? null

    if (!role) {
      throw forbidden('No perteneces a esta comunidad.')
    }

    req.community = { communityId, role }
    next()
  }
}

/**
 * Exige uno de los roles de comunidad indicados.
 *
 * Va DESPUES de `requireCommunity`, nunca antes: sin saber de que comunidad se
 * trata, un chequeo de rol no tiene sentido. El orden de los middleware en la
 * ruta es lo que lo garantiza, y por eso las rutas de comunidad se montan con
 * los dos en secuencia.
 */
export function requireCommunityRole(...roles: string[]) {
  return function roleGuard(req: Request, _res: Response, next: NextFunction): void {
    if (!req.community) {
      throw unauthorized()
    }

    if (!roles.includes(req.community.role)) {
      throw forbidden('Tu rol en esta comunidad no permite esta acción.')
    }

    next()
  }
}