// ---------------------------------------------------------------------------
// Controller de autenticacion.
//
// Su unico trabajo es traducir HTTP a llamadas al servicio y volver. No decide
// nada: si aparece una condicion de negocio aqui, es que se ha puesto en el
// sitio equivocado.
//
// En concreto, este archivo NO sabe cuando un refresh token es robado ni si una
// cuenta esta activa. Eso lo decide el servicio, y el codigo de error sale de
// alla a traves de la excepcion.
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express'
import { badRequest } from '../http/errors.js'
import { created, noContent, ok } from '../http/envelope.js'
import { env } from '../config/env.js'
import * as service from './service.js'
import { routeParam } from './middleware.js'
import { formatIssues, loginSchema, registerSchema } from './validators.js'
import type { ZodType } from 'zod'

function parse<T>(schema: ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload)

  if (!result.success) {
    throw badRequest('Los datos enviados no son válidos.', formatIssues(result.error))
  }

  return result.data
}

/** IP del cliente, respetando `trust proxy` si esta configurado. */
function clientInfo(req: Request) {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 500) ?? null,
  }
}

/**
 * Escribe la cookie de refresh.
 *
 * `httpOnly` para que JavaScript no la lea, que es lo que cierra el XSS. `secure`
 * para que no viaje en claro. `sameSite=strict` para que no salga en peticiones
 * de terceros, lo que da proteccion CSRF sin token. Y `path` restringido a
 * `/api/v1/auth`: la cookie solo viaja a los tres endpoints que la necesitan, que
 * es la respuesta a la pregunta 1 de la spec 01.
 *
 * El `secure` se puede desactivar solo en desarrollo, porque `localhost` en http
 * no acepta cookies `secure` y no habria forma de probar el login.
 */
function setRefreshCookie(res: Response, token: string): void {
  res.cookie(env.REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.REFRESH_COOKIE_SECURE,
    sameSite: env.REFRESH_COOKIE_SAMESITE,
    path: env.REFRESH_COOKIE_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  })
}

/**
 * Borra la cookie de refresh.
 *
 * Con los mismos atributos con los que se creo. Si no coinciden, el navegador no
 * la borra: el `path` o el nombre tienen que ser identicos, y ese es un fallo
 * silencioso que deja al cliente con un refresh token vivo para siempre.
 */
function clearRefreshCookie(res: Response): void {
  res.clearCookie(env.REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.REFRESH_COOKIE_SECURE,
    sameSite: env.REFRESH_COOKIE_SAMESITE,
    path: env.REFRESH_COOKIE_PATH,
  })
}

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = parse(registerSchema, req.body)
    const result = await service.register(input)
    created(res, result)
  } catch (error) {
    next(error)
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = parse(loginSchema, req.body)
    const result = await service.login({ ...input, ...clientInfo(req) })
    setRefreshCookie(res, result.refreshToken)
    // El refresh token viaja solo en la cookie httpOnly. Nunca en el cuerpo: si
    // fuera aqui, un XSS lo leeria de `localStorage` o de la respuesta JSON.
    const { refreshToken: _refreshToken, ...body } = result
    ok(res, body)
  } catch (error) {
    next(error)
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[env.REFRESH_COOKIE_NAME]

    if (typeof token !== 'string' || token.length === 0) {
      // Sin cookie no hay nada que renovar. Se responde con el mismo codigo que
      // un refresh invalido, para no distinguir los casos.
      clearRefreshCookie(res)
      res.status(401).json({
        error: { code: 'TOKEN_REVOKED', message: 'No hay sesión que renovar. Vuelve a entrar.' },
      })
      return
    }

    const result = await service.refresh({ refreshToken: token, ...clientInfo(req) })
    setRefreshCookie(res, result.refreshToken)
    const { refreshToken: _refreshToken, ...body } = result
    ok(res, body)
  } catch (error) {
    // Cualquier fallo aqui deja al cliente con una cookie que ya no vale. Sin
    // borrarla, el cliente reintenta en bucle con un token muerto.
    clearRefreshCookie(res)
    next(error)
  }
}

export async function logout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.logout({ userId: req.auth!.userId, sessionId: req.auth!.sessionId })
    clearRefreshCookie(res)
    noContent(res)
  } catch (error) {
    next(error)
  }
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    ok(res, await service.getMe(req.auth!.userId))
  } catch (error) {
    next(error)
  }
}

export async function listSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sessions = await service.listSessions({
      userId: req.auth!.userId,
      currentSessionId: req.auth!.sessionId,
    })
    ok(res, sessions)
  } catch (error) {
    next(error)
  }
}

export async function revokeSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.revokeSessionById({ userId: req.auth!.userId, sessionId: routeParam(req, 'id') })
    noContent(res)
  } catch (error) {
    next(error)
  }
}