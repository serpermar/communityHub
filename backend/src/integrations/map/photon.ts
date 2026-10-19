// ---------------------------------------------------------------------------
// Adaptador de Photon (EXT-8): geocodificado y POIs por proximidad.
//
// Photon (Komoot) habla GeoJSON y no exige clave, que es justo lo que pide el
// presupuesto $0 del proyecto. Se eligio sobre Nominatim porque la politica de
// Nominatim prohibe el uso desde herramientas _vibe-coding_/low-code y limita a
// 1 req/s (ARCHITECTURE.md §8); Photon cubre el mismo caso con las mismas datos
// de OSM.
//
// Dos operaciones sobre el mismo endpoint `/api/`:
//
//   - geocode(address): `?q=<direccion>&limit=1` -> la mejor coincidencia. Si no
//     hay features, devuelve `null` (no es un error de red; es "no resuelve",
//     que el service convierte en 422).
//   - searchNearby(lat, lon): `?lat=&lon=&limit=` -> features cercanas, que se
//     clasifican y filtran por radio en `map/geo.ts`. Photon no filtra por radio
//     (EXT-11).
//
// El parseo es defensivo: una feature sin `geometry.coordinates` o sin nombre se
// descarta en vez de romper. Un `osm_key` vacio es valido y cae en `Otro`.
// ---------------------------------------------------------------------------

import { env } from '../../config/env.js'
import { ExternalProviderError } from '../errors.js'
import { fetchJson } from '../http.js'
import type { GeocodeResult, GeocodingProvider, PlaceView } from '../types.js'
import { buildPlaceViews, type RawPlace } from './geo.js'

// --- Parseo defensivo de GeoJSON ---------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function featuresOf(payload: unknown): Array<Record<string, unknown>> {
  if (!isRecord(payload) || !Array.isArray(payload.features)) {
    throw new ExternalProviderError('Photon no ha devuelto una FeatureCollection.')
  }
  return payload.features.filter(isRecord)
}

function propsOf(feature: Record<string, unknown>): Record<string, unknown> {
  return isRecord(feature.properties) ? feature.properties : {}
}

function coordinatesOf(
  feature: Record<string, unknown>,
): { latitude: number; longitude: number } | null {
  const geometry = feature.geometry
  if (!isRecord(geometry) || !Array.isArray(geometry.coordinates)) return null

  const [lon, lat] = geometry.coordinates
  if (typeof lat !== 'number' || typeof lon !== 'number') return null

  return { latitude: lat, longitude: lon }
}

/** Compone una direccion legible a partir de las piezas de Photon, si las trae. */
function formatAddress(props: Record<string, unknown>): string | null {
  const street = str(props.street)
  const house = str(props.housenumber)
  const postal = str(props.postcode)
  const city = str(props.city)
  const country = str(props.country)

  const line1 = [street, house].filter(Boolean).join(' ')
  const line2 = [[postal, city].filter(Boolean).join(' '), country].filter(Boolean).join(', ')

  const parts = [line1, line2].filter((part) => part.length > 0)
  return parts.length > 0 ? parts.join(', ') : null
}

function toRawPlace(feature: Record<string, unknown>): RawPlace | null {
  const coordinates = coordinatesOf(feature)
  if (!coordinates) return null

  const props = propsOf(feature)
  const name =
    str(props.name) ?? [str(props.street), str(props.housenumber)].filter(Boolean).join(' ')
  if (!name) return null

  return {
    name,
    osmKey: str(props.osm_key) ?? '',
    osmValue: str(props.osm_value) ?? '',
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
    address: formatAddress(props),
  }
}

// --- Adaptador ---------------------------------------------------------------

export class PhotonProvider implements GeocodingProvider {
  readonly name = 'photon'

  async geocode(input: { address: string; signal?: AbortSignal }): Promise<GeocodeResult | null> {
    const params = new URLSearchParams({ q: input.address, limit: '1', lang: 'es' })
    const payload = await fetchJson(`${env.PHOTON_BASE_URL}/api/?${params.toString()}`, {
      signal: input.signal,
    })

    const first = featuresOf(payload)[0]
    if (!first) return null

    const coordinates = coordinatesOf(first)
    if (!coordinates) return null

    return {
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      formattedAddress: formatAddress(propsOf(first)),
      source: this.name,
    }
  }

  async searchNearby(input: {
    latitude: number
    longitude: number
    radiusM: number
    limit: number
    signal?: AbortSignal
  }): Promise<PlaceView[]> {
    const params = new URLSearchParams({
      lat: String(input.latitude),
      lon: String(input.longitude),
      limit: String(input.limit),
      lang: 'es',
    })

    const payload = await fetchJson(`${env.PHOTON_BASE_URL}/api/?${params.toString()}`, {
      signal: input.signal,
    })

    const raw = featuresOf(payload)
      .map(toRawPlace)
      .filter((place): place is RawPlace => place !== null)

    return buildPlaceViews(
      raw,
      { latitude: input.latitude, longitude: input.longitude },
      input.radiusM,
      input.limit,
    )
  }
}
