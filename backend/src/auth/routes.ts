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

  /**
   * @swagger
   * /api/v1/auth/register:
   *   post:
   *     summary: Registrar un usuario nuevo
   *     description: Crea la cuenta y devuelve el access token. También setea la cookie `refresh_token`.
   *     tags: [Auth]
   *     security: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [email, password, displayName]
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *               password:
   *                 type: string
   *                 minLength: 8
   *               displayName:
   *                 type: string
   *                 minLength: 1
   *                 maxLength: 80
   *     responses:
   *       201:
   *         description: Usuario creado.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AuthLoginResponse'
   *       400:
   *         $ref: '#/components/responses/Validation'
   *       409:
   *         description: Ya existe una cuenta con ese email
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Error'
   */
  router.post('/register', controller.register)

  /**
   * @swagger
   * /api/v1/auth/login:
   *   post:
   *     summary: Iniciar sesión con email y contraseña
   *     tags: [Auth]
   *     security: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [email, password]
   *             properties:
   *               email:
   *                 type: string
   *                 format: email
   *                 example: usuario@comunidad.com
   *               password:
   *                 type: string
   *                 minLength: 8
   *                 example: "MiContraseñaSegura123"
   *     responses:
   *       200:
   *         description: Login correcto. Devuelve el access token y setea la cookie `refresh_token`.
   *         headers:
   *           Set-Cookie:
   *             schema: { type: string }
   *             description: Contiene `refresh_token=<jwt>; HttpOnly; SameSite=Strict`
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AuthLoginResponse'
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       429:
   *         $ref: '#/components/responses/RateLimited'
   */
  router.post('/login', loginLimiter, controller.login)

  /**
   * @swagger
   * /api/v1/auth/refresh:
   *   post:
   *     summary: Renovar el access token usando la cookie de refresh
   *     description: No requiere `Authorization`, solo la cookie `refresh_token` (HttpOnly).
   *     tags: [Auth]
   *     security: []
   *     responses:
   *       200:
   *         description: Nuevo access token emitido.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data:
   *                   type: object
   *                   properties:
   *                     accessToken: { type: string }
   *                     expiresIn: { type: integer, example: 900 }
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       429:
   *         $ref: '#/components/responses/RateLimited'
   */
  router.post('/refresh', refreshLimiter, controller.refresh)

  /**
   * @swagger
   * /api/v1/auth/logout:
   *   post:
   *     summary: Cerrar la sesión actual
   *     description: Invalida el refresh token del servidor y borra la cookie.
   *     tags: [Auth]
   *     responses:
   *       204:
   *         description: Sesión cerrada.
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   */
  router.post('/logout', requireAuth, controller.logout)

  /**
   * @swagger
   * /api/v1/auth/me:
   *   get:
   *     summary: Datos del usuario autenticado
   *     tags: [Auth]
   *     responses:
   *       200:
   *         description: Perfil del usuario.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/User' }
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   */
  router.get('/me', requireAuth, controller.me)

  /**
   * @swagger
   * /api/v1/auth/me:
   *   patch:
   *     summary: Actualizar el perfil
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               displayName:
   *                 type: string
   *                 minLength: 1
   *                 maxLength: 80
   *     responses:
   *       200:
   *         description: Perfil actualizado.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data: { $ref: '#/components/schemas/User' }
   *       400:
   *         $ref: '#/components/responses/Validation'
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   */
  router.patch('/me', requireAuth, controller.updateProfile)

  /**
   * @swagger
   * /api/v1/auth/me/avatar:
   *   post:
   *     summary: Subir avatar del usuario
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             required: [avatar]
   *             properties:
   *               avatar:
   *                 type: string
   *                 format: binary
   *                 description: Imagen (máx. 2 MB, cualquier `image/*`).
   *     responses:
   *       200:
   *         description: Avatar actualizado.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AvatarResponse'
   *       400:
   *         $ref: '#/components/responses/Validation'
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   */
  router.post('/me/avatar', requireAuth, handleAvatarUpload, controller.uploadAvatar)

  /**
   * @swagger
   * /api/v1/auth/me/avatar:
   *   delete:
   *     summary: Eliminar el avatar del usuario
   *     tags: [Auth]
   *     responses:
   *       204:
   *         description: Avatar eliminado.
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   */
  router.delete('/me/avatar', requireAuth, controller.deleteAvatar)

  /**
   * @swagger
   * /api/v1/auth/change-password:
   *   post:
   *     summary: Cambiar la contraseña
   *     description: Exige la contraseña actual. Tras el cambio, se revocan las demás sesiones.
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [currentPassword, newPassword]
   *             properties:
   *               currentPassword: { type: string, format: password }
   *               newPassword: { type: string, format: password, minLength: 8 }
   *     responses:
   *       204:
   *         description: Contraseña cambiada.
   *       400:
   *         $ref: '#/components/responses/Validation'
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       429:
   *         $ref: '#/components/responses/RateLimited'
   */
  router.post('/change-password', requireAuth, changePasswordLimiter, controller.changePassword)

  /**
   * @swagger
   * /api/v1/auth/sessions:
   *   get:
   *     summary: Listar las sesiones activas del usuario
   *     tags: [Auth]
   *     responses:
   *       200:
   *         description: Sesiones activas.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data:
   *                   type: array
   *                   items: { $ref: '#/components/schemas/AuthSession' }
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   */
  router.get('/sessions', requireAuth, controller.listSessions)

  /**
   * @swagger
   * /api/v1/auth/sessions/revoke-others:
   *   post:
   *     summary: Revocar todas las sesiones salvo la actual
   *     tags: [Auth]
   *     responses:
   *       204:
   *         description: Sesiones revocadas (conserva la actual).
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   */
  router.post('/sessions/revoke-others', requireAuth, controller.revokeOtherSessions)

  /**
   * @swagger
   * /api/v1/auth/sessions/{id}:
   *   delete:
   *     summary: Revocar una sesión por id
   *     tags: [Auth]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       204:
   *         description: Sesión revocada.
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   *       404:
   *         $ref: '#/components/responses/NotFound'
   */
  router.delete('/sessions/:id', requireAuth, controller.revokeSession)

  /**
   * @swagger
   * /api/v1/auth/me/export:
   *   get:
   *     summary: Descargar todos los datos del usuario (GDPR)
   *     description: |
   *       Devuelve un volcado JSON con todo lo asociado al usuario: perfil,
   *       sesiones, comunidades, documentos, incidencias, reservas, votos,
   *       notificaciones, etc. Es el endpoint que estaba fallando con `42P17`
   *       por la recursión de RLS en `document_acl`; ya corregido.
   *     tags: [Auth]
   *     responses:
   *       200:
   *         description: Volcado completo.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/UserExport'
   *       401:
   *         $ref: '#/components/responses/Unauthorized'
   */
  router.get('/me/export', requireAuth, controller.exportAccountData)

  return router
}
