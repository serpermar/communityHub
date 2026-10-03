// ---------------------------------------------------------------------------
// Errores de la aplicacion.
//
// Un error de negocio lleva consigo su codigo HTTP y su codigo estable. El
// codigo es parte del contrato con el cliente: el frontend decide que hacer
// segun el codigo, nunca segun el mensaje, que es para las personas.
//
// El mensaje va en castellano porque quien lo lee es un vecino, y el enunciado
// del proyecto esta en castellano. Los identificadores van en ingles.
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_CREDENTIALS'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_REVOKED'
  | 'EMAIL_TAKEN'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'

export type ErrorBody = {
  error: {
    code: ErrorCode
    message: string
    details?: unknown
  }
}

export class AppError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly details?: unknown

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'VALIDATION_ERROR', message, details)

export const unauthorized = (message = 'Necesitas iniciar sesión.', code: ErrorCode = 'UNAUTHORIZED') =>
  new AppError(401, code, message)

export const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.')

export const tokenExpired = () =>
  new AppError(401, 'TOKEN_EXPIRED', 'La sesión ha caducado. Vuelve a entrar.')

export const tokenRevoked = () =>
  new AppError(401, 'TOKEN_REVOKED', 'La sesión ya no es válida. Vuelve a entrar.')

export const forbidden = (message = 'No tienes permiso para hacer esto.') =>
  new AppError(403, 'FORBIDDEN', message)

export const notFound = (message = 'No encontrado.') => new AppError(404, 'NOT_FOUND', message)

export const conflict = (code: ErrorCode, message: string) => new AppError(409, code, message)

export const rateLimited = (message = 'Demasiados intentos. Espera unos minutos y vuelve a probar.') =>
  new AppError(429, 'RATE_LIMITED', message)

export const internal = (message = 'Error interno.') => new AppError(500, 'INTERNAL_ERROR', message)