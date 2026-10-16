import { AxiosError } from 'axios'

export interface ApiErrorBody {
  code: string
  message: string
  details?: unknown
}

interface ErrorEnvelope {
  error: ApiErrorBody
}

export interface FieldIssue {
  path: string
  message: string
}

/**
 * Error normalizado del backend (decision FE-11).
 *
 * Todo fallo de la API llega aqui como `ApiError`: la UI solo lee `message` y,
 * cuando `code === 'VALIDATION_ERROR'`, `fieldIssues` para pintar los campos.
 */
export class ApiError extends Error implements ApiErrorBody {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, body: ApiErrorBody) {
    super(body.message)
    this.name = 'ApiError'
    this.status = status
    this.code = body.code
    this.details = body.details
  }

  get isValidation(): boolean {
    return this.code === 'VALIDATION_ERROR'
  }

  get isUnauthorized(): boolean {
    return this.status === 401
  }

  get isForbidden(): boolean {
    return this.status === 403
  }

  get isNotFound(): boolean {
    return this.status === 404
  }

  get isConflict(): boolean {
    return this.status === 409
  }

  /** `details` aplanado a pares campo/mensaje, para los formularios. */
  get fieldIssues(): FieldIssue[] {
    const details = this.details
    if (!Array.isArray(details)) return []
    return details.flatMap((issue) => {
      if (typeof issue !== 'object' || issue === null) return []
      const rec = issue as Record<string, unknown>
      const path = Array.isArray(rec.path) ? rec.path.join('.') : rec.path
      if (typeof path !== 'string' || typeof rec.message !== 'string') return []
      return [{ path, message: rec.message }]
    })
  }

  static from(error: unknown): ApiError {
    if (error instanceof ApiError) return error

    if (error instanceof AxiosError) {
      const status = error.response?.status ?? 0
      const body = error.response?.data as ErrorEnvelope | undefined
      if (body?.error) return new ApiError(status, body.error)
      return new ApiError(status, {
        code: status === 0 ? 'NETWORK_ERROR' : 'UNKNOWN',
        message:
          status === 0
            ? 'No se pudo conectar con el servidor.'
            : 'Ha ocurrido un error inesperado.',
      })
    }

    return new ApiError(0, {
      code: 'UNKNOWN',
      message: error instanceof Error ? error.message : 'Error inesperado.',
    })
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError
}
