// ---------------------------------------------------------------------------
// Validadores de notificaciones (spec 14 §10).
//
// Lo unico que merece un unitario aqui es el filtro `unread`: `z.coerce.boolean`
// habria convertido `?unread=quizá` en `true` sin quejarse, y este test es el
// que impide que alguien "simplifique" a esa coercion. Los limites de `page` y
// `limit` y los defaults se comprueban junto a el.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import { listQuerySchema, uuidSchema } from '../validators.js'

describe('listQuerySchema', () => {
  it('aplica los defaults: unread=false, page=1, limit=20', () => {
    expect(listQuerySchema.parse({})).toEqual({ unread: false, page: 1, limit: 20 })
  })

  it('unread=true activa el filtro', () => {
    expect(listQuerySchema.parse({ unread: 'true' }).unread).toBe(true)
  })

  it('unread=false lo deja apagado', () => {
    expect(listQuerySchema.parse({ unread: 'false' }).unread).toBe(false)
  })

  it('rechaza un unread que no sea true/false (no lo coercionа)', () => {
    expect(() => listQuerySchema.parse({ unread: 'quizá' })).toThrow()
    expect(() => listQuerySchema.parse({ unread: '1' })).toThrow()
  })

  it('acepta page y limit en rango y los coacciona a numero', () => {
    expect(listQuerySchema.parse({ page: '3', limit: '50' })).toMatchObject({ page: 3, limit: 50 })
  })

  it('rechaza page 0 y limit 0', () => {
    expect(() => listQuerySchema.parse({ page: '0' })).toThrow()
    expect(() => listQuerySchema.parse({ limit: '0' })).toThrow()
  })

  it('rechaza limit por encima de 100', () => {
    expect(() => listQuerySchema.parse({ limit: '101' })).toThrow()
  })

  it('rechaza parametros desconocidos', () => {
    expect(() => listQuerySchema.parse({ q: 'x' })).toThrow()
  })
})

describe('uuidSchema', () => {
  it('acepta un UUID', () => {
    expect(uuidSchema.parse('11111111-1111-1111-1111-111111111111')).toBe(
      '11111111-1111-1111-1111-111111111111',
    )
  })

  it('rechaza algo que no es un UUID', () => {
    expect(() => uuidSchema.parse('no-soy-un-uuid')).toThrow()
  })
})
