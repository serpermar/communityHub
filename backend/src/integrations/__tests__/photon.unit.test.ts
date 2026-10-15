// ---------------------------------------------------------------------------
// Adaptador de Photon (spec 12 §5.4, §14).
//
// Se prueba el parseo de GeoJSON: geocodificado (mejor coincidencia y direccion
// compuesta) y POIs por proximidad (clasificacion, filtro por radio y descarte
// de features sin nombre o sin geometria).
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from 'vitest'
import { PhotonProvider } from '../map/photon.js'

function feature(properties: Record<string, unknown>, coordinates: unknown = [-3.7038, 40.4168]) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates }, properties }
}

function stubFetch(payload: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => payload }) as unknown as Response))
}

afterEach(() => vi.unstubAllGlobals())

describe('PhotonProvider.geocode', () => {
  it('devuelve la mejor coincidencia con la direccion compuesta', async () => {
    stubFetch({
      type: 'FeatureCollection',
      features: [
        feature({
          name: 'Calle Mayor',
          osm_key: 'highway',
          osm_value: 'residential',
          street: 'Calle Mayor',
          housenumber: '1',
          postcode: '28013',
          city: 'Madrid',
          country: 'España',
        }),
      ],
    })

    const result = await new PhotonProvider().geocode({ address: 'Calle Mayor 1, Madrid' })

    expect(result).toEqual({
      latitude: 40.4168,
      longitude: -3.7038,
      formattedAddress: 'Calle Mayor 1, 28013 Madrid, España',
      source: 'photon',
    })
  })

  it('sin features devuelve null (no resuelve, no es un error de red)', async () => {
    stubFetch({ type: 'FeatureCollection', features: [] })
    await expect(new PhotonProvider().geocode({ address: 'xxx' })).resolves.toBeNull()
  })

  it('una feature sin geometria devuelve null en vez de romper', async () => {
    stubFetch({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'x' } }] })
    await expect(new PhotonProvider().geocode({ address: 'xxx' })).resolves.toBeNull()
  })
})

describe('PhotonProvider.searchNearby', () => {
  it('clasifica, filtra por radio y descarta features sin nombre o sin geometria', async () => {
    stubFetch({
      type: 'FeatureCollection',
      features: [
        feature({ name: 'Ferretería', osm_key: 'shop', osm_value: 'hardware' }, [-3, 40.001]), // ~111 m, proveedor
        feature({ name: 'Parque', osm_key: 'leisure', osm_value: 'park' }, [-3, 40.002]), // ~222 m, POI
        feature({ name: 'Lejísimos', osm_key: 'leisure', osm_value: 'park' }, [-3, 40.5]), // fuera de radio
        feature({ osm_key: 'shop', osm_value: 'hardware' }, [-3, 40.0015]), // sin nombre -> fuera
        { type: 'Feature', properties: { name: 'sin geom', osm_key: 'leisure', osm_value: 'park' } }, // sin geometria
      ],
    })

    const places = await new PhotonProvider().searchNearby({ latitude: 40, longitude: -3, radiusM: 1_500, limit: 25 })

    expect(places.map((p) => p.name)).toEqual(['Ferretería', 'Parque'])
    expect(places.map((p) => p.category)).toEqual(['Ferretería', 'Parque'])
    expect(places.every((p) => p.distanceM <= 1_500)).toBe(true)
  })
})
