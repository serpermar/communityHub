// ---------------------------------------------------------------------------
// Servicio de APIs externas: el unico sitio que orquesta.
//
// Reparte el trabajo asi:
//
//   community (RLS)  ->  ?cache fresca  ->  proveedor  ->  normaliza  ->  DTO
//
// y decide la degradacion (§6.4). Ningun otro archivo del bloque decide: el
// controller reparte HTTP y los adaptadores solo hablan con el proveedor.
//
// Tres invariantes que conviene tener presentes:
//
//   1. El frontend NUNCA sale a la red (EXT-1). Todo pasa por aqui.
//   2. `weather`/`map` NUNCA devuelven 5xx por un proveedor caido (EXT-2):
//      degradan con `data` parcial o nula y `meta.reason`. Solo `geocode`, que
//      es una accion explicita, falla ruidosamente (502/503/422).
//   3. El contexto de RLS se pasa siempre. No se usa el singleton de Prisma en
//      ningun punto.
//
// El `location` del mapa sale SIEMPRE de la base de datos (§6.4): es dato
// propio, no del proveedor. Por eso `map` devuelve `data` completo incluso
// cuando degrada, mientras que `weather` puede devolver `data: null`.
// ---------------------------------------------------------------------------

import { withContext } from '../context.js'
import { env } from '../config/env.js'
import { externalNotConfigured, externalProviderError, geocodingFailed, notFound } from '../http/errors.js'
import {
  asGeocodeResult,
  asMapPayload,
  asWeatherReading,
} from './validators.js'
import {
  cacheGet,
  cachePut,
  geocodeCacheKey,
  geocodeTtlSeconds,
  mapCacheKey,
  mapTtlSeconds,
  weatherCacheKey,
  weatherTtlSeconds,
  type CachedEntry,
} from './cache.js'
import { classify } from './map/categories.js'
import { ExternalProviderError } from './errors.js'
import { getGeocodingProvider, getWeatherProvider } from './providers.js'
import * as repo from './repository.js'
import type {
  DegradeReason,
  GeocodeResult,
  MapLocation,
  MapPayload,
  MapView,
  PlaceView,
  WeatherReading,
  WeatherView,
} from './types.js'

export type ExternalMeta = {
  cached: boolean
  stale: boolean
  degraded: boolean
  reason?: DegradeReason
  source?: string
}

export type WeatherResult = { data: WeatherView | null; meta: ExternalMeta }
export type MapResult = { data: MapView; meta: ExternalMeta }

function meta(input: Partial<ExternalMeta> = {}): ExternalMeta {
  return { cached: false, stale: false, degraded: false, ...input }
}

// --- Helpers -----------------------------------------------------------------

function toCoordinate(value: { toNumber(): number } | null): number | null {
  return value == null ? null : value.toNumber()
}

/**
 * Las coordenadas de la comunidad, o `null` si no sirven.
 *
 * `null` cubre dos casos que el resto del bloque trata igual: "todavia no se ha
 * geocodificado" y "el dato esta corrupto" (fuera de rango). Nunca se llama al
 * proveedor con coordenadas invalidas (§11.4).
 */
function coordinatesOf(row: repo.CommunityRow): { latitude: number; longitude: number } | null {
  const latitude = toCoordinate(row.latitude)
  const longitude = toCoordinate(row.longitude)

  if (latitude === null || longitude === null) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null

  return { latitude, longitude }
}

/** La direccion de la comunidad lista para geocodificar, o `null` si esta vacia. */
function composeAddress(row: repo.CommunityRow): string | null {
  const street = row.address_line1.trim()
  const city = row.city.trim()

  // Sin calle ni ciudad no hay nada que resolver. El `country` (por defecto 'ES')
  // no cuenta: geocodificar "ES" devolveria el centro del pais.
  if (!street && !city) return null

  const line1 = [street, row.postal_code?.trim()].filter(Boolean).join(' ')
  const line2 = [city, row.province?.trim()].filter(Boolean).join(', ')
  const parts = [line1, line2, row.country.trim()].filter((part) => part.length > 0)

  return parts.join(', ')
}

function weatherView(reading: WeatherReading, row: repo.CommunityRow, coords: { latitude: number; longitude: number }): WeatherView {
  return {
    location: {
      city: row.city,
      latitude: coords.latitude,
      longitude: coords.longitude,
      timezone: row.timezone,
    },
    ...reading,
  }
}

function mapLocation(row: repo.CommunityRow): MapLocation {
  return {
    addressLine1: row.address_line1,
    city: row.city,
    province: row.province,
    postalCode: row.postal_code,
    country: row.country,
    latitude: toCoordinate(row.latitude),
    longitude: toCoordinate(row.longitude),
    timezone: row.timezone,
  }
}

/** Parte los lugares en proveedores y POIs, recalculando el `kind` (EXT-12). */
function mapView(location: MapLocation, places: PlaceView[], updatedAt: string | null, source: string): MapView {
  const providers: PlaceView[] = []
  const pois: PlaceView[] = []

  for (const place of places) {
    if (classify(place.osmKey, place.osmValue).kind === 'provider') providers.push(place)
    else pois.push(place)
  }

  return { location, providers, pois, updatedAt, source }
}

function emptyMap(location: MapLocation, source: string): MapView {
  return { location, providers: [], pois: [], updatedAt: null, source }
}

// --- Puertas a la base de datos ----------------------------------------------

async function loadCommunity(userId: string, communityId: string): Promise<repo.CommunityRow> {
  const row = await withContext({ userId, communityId }, (tx) => repo.findCommunity(tx, communityId))

  if (!row) throw notFound('La comunidad no existe.')

  return row
}

function readCache(userId: string, communityId: string, key: string): Promise<CachedEntry | null> {
  return withContext({ userId, communityId }, (tx) => cacheGet(tx, key))
}

function writeCache(
  userId: string,
  communityId: string,
  input: { key: string; provider: string; payload: unknown; ttlSeconds: number },
): Promise<void> {
  return withContext({ userId, communityId }, (tx) => cachePut(tx, input))
}

// --- Meteorologia (EXT-2, EXT-4) ---------------------------------------------

export async function getWeather(userId: string, communityId: string): Promise<WeatherResult> {
  const provider = getWeatherProvider()
  const community = await loadCommunity(userId, communityId)

  if (!provider) {
    return { data: null, meta: meta({ degraded: true, reason: 'DISABLED' }) }
  }

  const coords = coordinatesOf(community)
  if (!coords) {
    return { data: null, meta: meta({ reason: 'NO_LOCATION' }) }
  }

  const key = weatherCacheKey({ ...coords, timezone: community.timezone })
  const cached = await readCache(userId, communityId, key)

  if (cached?.isFresh) {
    const reading = asWeatherReading(cached.payload)
    if (reading) {
      return { data: weatherView(reading, community, coords), meta: meta({ cached: true, source: reading.source }) }
    }
  }

  try {
    const reading = await provider.fetchWeather({ ...coords, timezone: community.timezone })
    await writeCache(userId, communityId, {
      key,
      provider: provider.name,
      payload: reading,
      ttlSeconds: weatherTtlSeconds(),
    })
    return { data: weatherView(reading, community, coords), meta: meta({ source: reading.source }) }
  } catch (error) {
    if (!(error instanceof ExternalProviderError)) throw error

    // Stale-while-error (EXT-4): hay una entrada caducada, se sirve marcada.
    const stale = cached ? asWeatherReading(cached.payload) : null
    if (stale) {
      return { data: weatherView(stale, community, coords), meta: meta({ stale: true, source: stale.source }) }
    }

    return { data: null, meta: meta({ degraded: true, reason: 'PROVIDER_ERROR' }) }
  }
}

// --- Mapa (EXT-2, EXT-11) ----------------------------------------------------

export async function getMap(userId: string, communityId: string): Promise<MapResult> {
  const provider = getGeocodingProvider()
  const community = await loadCommunity(userId, communityId)
  const location = mapLocation(community)

  if (!provider) {
    return { data: emptyMap(location, 'photon'), meta: meta({ degraded: true, reason: 'DISABLED' }) }
  }

  const coords = coordinatesOf(community)
  if (!coords) {
    return { data: emptyMap(location, provider.name), meta: meta({ reason: 'NO_LOCATION' }) }
  }

  const radiusM = env.MAP_SEARCH_RADIUS_M
  const limit = env.MAP_MAX_RESULTS
  const key = mapCacheKey({ ...coords, radiusM, limit })
  const cached = await readCache(userId, communityId, key)

  if (cached?.isFresh) {
    const payload = asMapPayload(cached.payload)
    if (payload) {
      return {
        data: mapView(location, payload.places, payload.updatedAt, payload.source),
        meta: meta({ cached: true, source: payload.source }),
      }
    }
  }

  try {
    const places = await provider.searchNearby({ ...coords, radiusM, limit })
    const payload: MapPayload = { places, updatedAt: new Date().toISOString(), source: provider.name }

    await writeCache(userId, communityId, {
      key,
      provider: provider.name,
      payload,
      ttlSeconds: mapTtlSeconds(),
    })

    return { data: mapView(location, places, payload.updatedAt, payload.source), meta: meta({ source: provider.name }) }
  } catch (error) {
    if (!(error instanceof ExternalProviderError)) throw error

    const stale = cached ? asMapPayload(cached.payload) : null
    if (stale) {
      return {
        data: mapView(location, stale.places, stale.updatedAt, stale.source),
        meta: meta({ stale: true, source: stale.source }),
      }
    }

    return { data: emptyMap(location, provider.name), meta: meta({ degraded: true, reason: 'PROVIDER_ERROR' }) }
  }
}

// --- Geocodificado (EXT-9, EXT-14) -------------------------------------------

/**
 * Rellena las coordenadas de la comunidad a partir de su direccion guardada.
 *
 * Es el unico endpoint que escribe, y lo hace en la ultima transaccion, despues
 * del proveedor: primero se resuelve (red + cache), y solo si hay coordenadas se
 * toca la base de datos. No se reescribe la direccion del usuario (EXT-10): la
 * maquina aporta la posicion, no corrige a la persona.
 */
export async function geocode(userId: string, communityId: string, role: string | null): Promise<GeocodeResult> {
  const provider = getGeocodingProvider()
  const community = await loadCommunity(userId, communityId)

  if (!provider) throw externalNotConfigured()

  const address = composeAddress(community)
  if (!address) throw geocodingFailed('La comunidad no tiene una dirección que se pueda geocodificar.')

  const key = geocodeCacheKey(address)
  const cached = await readCache(userId, communityId, key)

  let result = cached?.isFresh ? asGeocodeResult(cached.payload) : null

  if (!result) {
    let fresh: GeocodeResult | null
    try {
      fresh = await provider.geocode({ address })
    } catch (error) {
      if (error instanceof ExternalProviderError) throw externalProviderError(error.message)
      throw error
    }

    if (fresh) {
      result = fresh
      await writeCache(userId, communityId, {
        key,
        provider: provider.name,
        payload: fresh,
        ttlSeconds: geocodeTtlSeconds(),
      })
    }
  }

  if (!result) throw geocodingFailed()

  const resolved = result

  await withContext({ userId, communityId }, async (tx) => {
    const affected = await repo.updateCoordinates(tx, communityId, resolved.latitude, resolved.longitude)

    if (affected === 0) throw notFound('La comunidad no existe.')

    await repo.insertGeocodeAudit(tx, {
      actorId: userId,
      actorRole: role,
      communityId,
      metadata: {
        latitude: resolved.latitude,
        longitude: resolved.longitude,
        source: resolved.source,
        formattedAddress: resolved.formattedAddress,
      },
    })
  })

  return resolved
}
