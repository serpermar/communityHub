// ---------------------------------------------------------------------------
// Rutas de autenticacion.
//
// Prefijo /api/v1/auth. El orden importa: `requireAuth` antes que el controller,
// siempre. Un endpoint que no lo lleve es un endpoint publico, y eso tiene que
// ser una decision consciente, no un olvido.
// ---------------------------------------------------------------------------

import { Router } from 'express'
import multer, { MulterError } from 'multer'
import type { NextFunction, Request, Response } from 'express'
import * as controller from './controller.js'
import { requireAuth } from './middleware.js'
import {
  createChangePasswordRateLimiter,
  createLoginRateLimiter,
  createRefreshRateLimiter,
} from '../http/ratelimit.js'
import { badRequest } from '../http/errors.js'

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true)
    } else {
      cb(new Error('Solo se permiten imágenes.'))
    }
  },
})

function handleAvatarUpload(req: Request, res: Response, next: NextFunction): void {
  avatarUpload.single('avatar')(req, res, (error: unknown) => {
    if (!error) {
      next()
      return
    }
    if (error instanceof MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        next(badRequest('El avatar no puede superar 2 MB.'))
        return
      }
      next(badRequest('La subida del avatar ha fallado.'))
      return
    }
    if (error instanceof Error && error.message === 'Solo se permiten imágenes.') {
      next(badRequest(error.message))
      return
    }
    next(error)
  })
}

export function createAuthRouter(): Router {
  const router = Router()
  const loginLimiter = createLoginRateLimiter()
  const refreshLimiter = createRefreshRateLimiter()
  const changePasswordLimiter = createChangePasswordRateLimiter()

  // Publicos. El limite de intentos va solo en el login: el registro tambien
  // escribe en la base de datos, pero un 429 ahi impediria dar de alta a varias
  // personas desde la misma IP, que en un portal de una comunidad es el caso
  // normal (mismo router, mismo vecindario).
  router.post('/register', controller.register)
  router.post('/login', loginLimiter, controller.login)
  router.post('/refresh', refreshLimiter, controller.refresh)

  // Protegidos.
  router.post('/logout', requireAuth, controller.logout)
  router.get('/me', requireAuth, controller.me)
  router.patch('/me', requireAuth, controller.updateProfile)
  router.post('/me/avatar', requireAuth, handleAvatarUpload, controller.uploadAvatar)
  router.delete('/me/avatar', requireAuth, controller.deleteAvatar)
  router.post('/change-password', requireAuth, changePasswordLimiter, controller.changePassword)
  router.get('/sessions', requireAuth, controller.listSessions)
  router.post('/sessions/revoke-others', requireAuth, controller.revokeOtherSessions)
  router.get('/me/export', requireAuth, controller.exportMyData)
  router.delete('/sessions/:id', requireAuth, controller.revokeSession)

  return router
}
