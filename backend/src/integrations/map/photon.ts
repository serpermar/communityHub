// ---------------------------------------------------------------------------
// Adaptador de Photon (EXT-8): geocodificado y POIs por proximidad.
// ---------------------------------------------------------------------------

import { env } from '../../config/env.js'
import { ExternalProviderError } from '../errors.js'
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
    const params = new URLSearchParams({ q: input.address, limit: '1', lang: 'en' })
    const url = `${env.PHOTON_BASE_URL}/api/?${params.toString()}`

    // Usamos fetch nativo para poder pasar la cabecera User-Agent
    const response = await fetch(url, {
      signal: input.signal,
      headers: {
        'User-Agent': 'CommunityHub/1.0 (soporte@communityhub.com)',
      },
    })

    if (!response.ok) {
      throw new ExternalProviderError(`Photon respondió con estado ${response.status}`)
    }

    const payload = await response.json()
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

    const url = `${env.PHOTON_BASE_URL}/api/?${params.toString()}`

    const response = await fetch(url, {
      signal: input.signal,
      headers: {
        'User-Agent': 'CommunityHub/1.0 (soporte@communityhub.com)',
      },
    })

    if (!response.ok) {
      throw new ExternalProviderError(`Photon respondió con estado ${response.status}`)
    }

    const payload = await response.json()
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
