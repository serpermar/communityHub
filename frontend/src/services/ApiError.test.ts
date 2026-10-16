import { describe, expect, it } from 'vitest'
import { ApiError, isApiError } from './ApiError'

describe('ApiError', () => {
  it('expone código, estado y detalles', () => {
    const error = new ApiError(403, { code: 'FORBIDDEN', message: 'No autorizado' })
    expect(error.isForbidden).toBe(true)
    expect(error.isValidation).toBe(false)
    expect(error.code).toBe('FORBIDDEN')
  })

  it('aplana los detalles de validación', () => {
    const error = new ApiError(400, {
      code: 'VALIDATION_ERROR',
      message: 'Datos inválidos',
      details: [
        { path: ['title'], message: 'requerido' },
        { path: 'amount', message: 'positivo' },
      ],
    })
    expect(error.isValidation).toBe(true)
    expect(error.fieldIssues).toEqual([
      { path: 'title', message: 'requerido' },
      { path: 'amount', message: 'positivo' },
    ])
  })

  it('envuelve errores desconocidos', () => {
    const error = ApiError.from(new Error('boom'))
    expect(error.code).toBe('UNKNOWN')
    expect(error.message).toBe('boom')
    expect(isApiError(error)).toBe(true)
  })

  it('devuelve el mismo ApiError si ya lo es', () => {
    const original = new ApiError(404, { code: 'NOT_FOUND', message: 'x' })
    expect(ApiError.from(original)).toBe(original)
    expect(original.isNotFound).toBe(true)
  })

  it('ignora detalles con formato incorrecto', () => {
    const error = new ApiError(400, {
      code: 'VALIDATION_ERROR',
      message: 'x',
      details: ['nope', { path: 1 }, { path: ['a'], message: 2 }],
    })
    expect(error.fieldIssues).toEqual([])
  })
})
