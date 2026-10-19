// ---------------------------------------------------------------------------
// Haversine y armado de la lista de lugares (spec 12 §5.4, EXT-11, §14).
//
// Tres garantias que se comprueban aqui, porque son las que Photon no da:
// filtro por radio real, orden por cercania y recorte a `limit`.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import { buildPlaceViews, haversineMeters, type RawPlace } from '../map/geo.js'

describe('haversineMeters', () => {
  it('0.001 grados de latitud son ~111 m', () => {
    const d = haversineMeters({ latitude: 40, longitude: -3 }, { latitude: 40.001, longitude: -3 })
    expect(d).toBeCloseTo(111.19, 0)
  })

  it('0.01 grados de longitud en el ecuador son ~1112 m', () => {
    const d = haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.01 })
    expect(d).toBeCloseTo(1111.95, 0)
  })

  it('la distancia de un punto a si mismo es 0', () => {
    expect(
      haversineMeters({ latitude: 40.4, longitude: -3.7 }, { latitude: 40.4, longitude: -3.7 }),
    ).toBe(0)
  })
})

function place(name: string, latitude: number, longitude = -3): RawPlace {
  return { name, osmKey: 'leisure', osmValue: 'park', latitude, longitude, address: null }
}

describe('buildPlaceViews', () => {
  const origin = { latitude: 40, longitude: -3 }

  it('descarta lo que supera el radio', () => {
    // ~111 m y ~2.3 km desde el origen.
    const places = buildPlaceViews(
      [place('cerca', 40.001), place('lejos', 40.02)],
      origin,
      1_500,
      25,
    )
    expect(places.map((p) => p.name)).toEqual(['cerca'])
  })

  it('ordena por distancia ascendente aunque la entrada venga desordenada', () => {
    const places = buildPlaceViews(
      [place('lejos', 40.01), place('cerca', 40.001)],
      origin,
      1_500,
      25,
    )
    expect(places.map((p) => p.name)).toEqual(['cerca', 'lejos'])
  })

  it('recorta a `limit` tras ordenar', () => {
    const raw = [place('a', 40.004), place('b', 40.001), place('c', 40.002)]
    const places = buildPlaceViews(raw, origin, 1_500, 2)
    expect(places.map((p) => p.name)).toEqual(['b', 'c'])
  })

  it('añade la etiqueta de categoria y la distancia redondeada', () => {
    const [first] = buildPlaceViews([place('parque', 40.001)], origin, 1_500, 25)
    expect(first?.category).toBe('Parque')
    expect(first?.distanceM).toBe(111)
    expect(Number.isInteger(first?.distanceM)).toBe(true)
  })

  it('una lista vacia da una lista vacia, no un error', () => {
    expect(buildPlaceViews([], origin, 1_500, 25)).toEqual([])
  })
})
