// ---------------------------------------------------------------------------
// Construccion de claves de cache y TTL (spec 12 §5.2, §14).
//
// Son funciones puras, asi que se prueban sin base de datos. Lo que se comprueba:
// que el redondeo a 4 decimales agrupa comunidades vecinas, que la zona horaria
// forma parte de la clave de meteorologia, que la direccion se normaliza antes
// de hashear (para no pagar dos veces por la misma), y que las claves son hashes
// estables y distintos entre recursos.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import { geocodeCacheKey, mapCacheKey, roundCoordinate, weatherCacheKey } from '../cache.js'

describe('roundCoordinate', () => {
  it('redondea a 4 decimales (~11 m)', () => {
    expect(roundCoordinate(40.416775)).toBe(40.4168)
    expect(roundCoordinate(-3.70379)).toBe(-3.7038)
  })
})

describe('weatherCacheKey', () => {
  it('es estable para la misma entrada', () => {
    const a = weatherCacheKey({ latitude: 40.4168, longitude: -3.7038, timezone: 'Europe/Madrid' })
    const b = weatherCacheKey({ latitude: 40.4168, longitude: -3.7038, timezone: 'Europe/Madrid' })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('agrupa coordenadas que solo difieren a partir de la 5ª cifra', () => {
    const a = weatherCacheKey({
      latitude: 40.416775,
      longitude: -3.70379,
      timezone: 'Europe/Madrid',
    })
    const b = weatherCacheKey({
      latitude: 40.416774,
      longitude: -3.70379,
      timezone: 'Europe/Madrid',
    })
    expect(a).toBe(b)
  })

  it('la zona horaria forma parte de la clave', () => {
    const a = weatherCacheKey({ latitude: 40.4, longitude: -3.7, timezone: 'Europe/Madrid' })
    const b = weatherCacheKey({ latitude: 40.4, longitude: -3.7, timezone: 'Atlantic/Canary' })
    expect(a).not.toBe(b)
  })
})

describe('mapCacheKey', () => {
  it('incluye radio y tope, y difiere del de meteorologia', () => {
    const base = mapCacheKey({ latitude: 40.4, longitude: -3.7, radiusM: 1_500, limit: 25 })
    const otherLimit = mapCacheKey({ latitude: 40.4, longitude: -3.7, radiusM: 1_500, limit: 50 })
    const otherRadius = mapCacheKey({ latitude: 40.4, longitude: -3.7, radiusM: 3_000, limit: 25 })
    const weather = weatherCacheKey({ latitude: 40.4, longitude: -3.7, timezone: 'Europe/Madrid' })

    expect(base).not.toBe(otherLimit)
    expect(base).not.toBe(otherRadius)
    expect(base).not.toBe(weather)
  })
})

describe('geocodeCacheKey', () => {
  it('normaliza mayusculas y espacios antes de hashear', () => {
    const a = geocodeCacheKey('Calle Mayor 1, Madrid')
    const b = geocodeCacheKey('  calle   mayor   1, madrid ')
    expect(a).toBe(b)
  })

  it('direcciones distintas dan claves distintas', () => {
    expect(geocodeCacheKey('Calle Mayor 1')).not.toBe(geocodeCacheKey('Calle Mayor 2'))
  })

  it('no deja la direccion en claro en la clave', () => {
    expect(geocodeCacheKey('Calle Mayor 1, Madrid')).not.toContain('mayor')
  })
})
