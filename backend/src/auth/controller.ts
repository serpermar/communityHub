// ---------------------------------------------------------------------------
// Controller de autenticacion.
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express'
import { badRequest, tokenRevoked } from '../http/errors.js'
import { created, noContent, ok } from '../http/envelope.js'
import { env } from '../config/env.js'
import * as service from './service.js'
import { routeParam } from './middleware.js'
import {
  changePasswordSchema,
  formatIssues,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from './validators.js'
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

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(env.REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.REFRESH_COOKIE_SECURE,
    sameSite: env.REFRESH_COOKIE_SAMESITE,
    path: env.REFRESH_COOKIE_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  })
}

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
      throw tokenRevoked()
    }

    const result = await service.refresh({ refreshToken: token, ...clientInfo(req) })
    setRefreshCookie(res, result.refreshToken)
    const { refreshToken: _refreshToken, ...body } = result
    ok(res, body)
  } catch (error) {
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

export async function updateProfile(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = parse(updateProfileSchema, req.body)
    ok(res, await service.updateProfile(req.auth!.userId, input))
  } catch (error) {
    next(error)
  }
}

export async function uploadAvatar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const file = req.file
    if (!file) {
      throw badRequest('El archivo es obligatorio.')
    }
    ok(
      res,
      await service.uploadAvatar(req.auth!.userId, {
        buffer: file.buffer,
        mimetype: file.mimetype,
      }),
    )
  } catch (error) {
    next(error)
  }
}

export async function deleteAvatar(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    ok(res, await service.deleteAvatar(req.auth!.userId))
  } catch (error) {
    next(error)
  }
}

export async function changePassword(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = parse(changePasswordSchema, req.body)
    await service.changePassword({
      userId: req.auth!.userId,
      sessionId: req.auth!.sessionId,
      ...input,
    })
    noContent(res)
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

export async function revokeSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await service.revokeSessionById({ userId: req.auth!.userId, sessionId: routeParam(req, 'id') })
    noContent(res)
  } catch (error) {
    next(error)
  }
}

export async function revokeOtherSessions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await service.revokeOtherSessions({ userId: req.auth!.userId, sessionId: req.auth!.sessionId })
    noContent(res)
  } catch (error) {
    next(error)
  }
}

/**
 * Exporta todos los datos del usuario en formato JSON y los envía como archivo adjunto.
 */
export async function exportAccountData(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.auth!.userId
    const data = await service.exportUserData(userId)

    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="communityhub-mis-datos-${Date.now()}.json"`,
    )
    res.send(JSON.stringify({ data }, null, 2))
  } catch (error) {
    next(error)
  }
}
