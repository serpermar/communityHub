// ---------------------------------------------------------------------------
// Servicio: orquestacion de cache, proveedor y degradacion (spec 12 §6.4, §14).
//
// El service toca la base de datos, pero su logica interesante —cuando servir de
// cache, cuando degradar, cuando fallar— no depende del contenido de una fila
// concreta. Aqui se aíslan las puertas de entrada (contexto, cache, repositorio)
// con mocks y se comprueba la decision, que es lo que la suite de integracion no
// puede provocar facilmente (p.ej. una cache caducada con el proveedor caido).
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExternalProviderError } from '../errors.js'
import { FakeGeocodingProvider } from '../map/fake.js'
import { FakeWeatherProvider, defaultReading } from '../weather/fake.js'
import {
  resetProviders,
  setGeocodingProvider,
  setWeatherProvider,
} from '../providers.js'
import type { GeocodeResult, WeatherReading } from '../types.js'
import * as service from '../service.js'

const mocks = vi.hoisted(() => ({
  cacheGet: vi.fn(),
  cachePut: vi.fn(),
  findCommunity: vi.fn(),
  updateCoordinates: vi.fn(),
  insertGeocodeAudit: vi.fn(),
}))

vi.mock('../../context.js', () => ({
  withContext: async (_ctx: unknown, fn: (tx: unknown) => unknown) => fn({}),
}))

vi.mock('../cache.js', () => ({
  cacheGet: mocks.cacheGet,
  cachePut: mocks.cachePut,
  weatherCacheKey: () => 'weather-key',
  mapCacheKey: () => 'map-key',
  geocodeCacheKey: () => 'geo-key',
  weatherTtlSeconds: () => 900,
  mapTtlSeconds: () => 3_600,
  geocodeTtlSeconds: () => 604_800,
}))

vi.mock('../repository.js', () => ({
  findCommunity: mocks.findCommunity,
  updateCoordinates: mocks.updateCoordinates,
  insertGeocodeAudit: mocks.insertGeocodeAudit,
}))

const COMMUNITY = {
  id: 'community-1',
  name: 'Comunidad',
  address_line1: 'Calle Mayor 1',
  city: 'Madrid',
  province: 'Madrid',
  postal_code: '28013',
  country: 'ES',
  latitude: { toNumber: () => 40.4168 },
  longitude: { toNumber: () => -3.7038 },
  timezone: 'Europe/Madrid',
}

function reading(over: Partial<WeatherReading> = {}): WeatherReading {
  return { ...defaultReading(), ...over }
}

beforeEach(() => {
  vi.resetAllMocks()
  resetProviders()
  mocks.findCommunity.mockResolvedValue(COMMUNITY)
  mocks.updateCoordinates.mockResolvedValue(1)
  mocks.insertGeocodeAudit.mockResolvedValue(undefined)
})

describe('getWeather', () => {
  it('cache fresca: sirve de cache y no llama al proveedor', async () => {
    const provider = new FakeWeatherProvider(() => {
      throw new Error('no debería llamarse')
    })
    setWeatherProvider(provider)
    mocks.cacheGet.mockResolvedValue({ payload: reading(), expiresAt: new Date(), isFresh: true })

    const result = await service.getWeather('user-1', 'community-1')

    expect(result.meta.cached).toBe(true)
    expect(result.data?.location.city).toBe('Madrid')
    expect(provider.calls).toHaveLength(0)
  })

  it('sin cache: llama al proveedor y guarda en cache', async () => {
    const provider = new FakeWeatherProvider([reading()])
    setWeatherProvider(provider)
    mocks.cacheGet.mockResolvedValue(null)

    const result = await service.getWeather('user-1', 'community-1')

    expect(result.meta.cached).toBe(false)
    expect(result.data?.current.temperatureC).toBe(21)
    expect(provider.calls).toHaveLength(1)
    expect(mocks.cachePut).toHaveBeenCalledOnce()
  })

  it('proveedor cae sin cache: degrada con PROVIDER_ERROR', async () => {
    setWeatherProvider(new FakeWeatherProvider(() => { throw new ExternalProviderError('boom') }))
    mocks.cacheGet.mockResolvedValue(null)

    const result = await service.getWeather('user-1', 'community-1')

    expect(result.data).toBeNull()
    expect(result.meta.degraded).toBe(true)
    expect(result.meta.reason).toBe('PROVIDER_ERROR')
  })

  it('proveedor cae con cache caducada: sirve la cache marcada stale', async () => {
    setWeatherProvider(new FakeWeatherProvider(() => { throw new ExternalProviderError('boom') }))
    mocks.cacheGet.mockResolvedValue({ payload: reading(), expiresAt: new Date(0), isFresh: false })

    const result = await service.getWeather('user-1', 'community-1')

    expect(result.data?.current.temperatureC).toBe(21)
    expect(result.meta.stale).toBe(true)
    expect(result.meta.cached).toBe(false)
  })

  it('sin proveedor: degrada con DISABLED', async () => {
    setWeatherProvider(null)

    const result = await service.getWeather('user-1', 'community-1')

    expect(result.data).toBeNull()
    expect(result.meta.reason).toBe('DISABLED')
  })

  it('sin coordenadas: NO_LOCATION y no se llama al proveedor', async () => {
    const provider = new FakeWeatherProvider([])
    setWeatherProvider(provider)
    mocks.findCommunity.mockResolvedValue({ ...COMMUNITY, latitude: null, longitude: null })

    const result = await service.getWeather('user-1', 'community-1')

    expect(result.data).toBeNull()
    expect(result.meta.reason).toBe('NO_LOCATION')
    expect(provider.calls).toHaveLength(0)
  })

  it('coordenadas fuera de rango se tratan como NO_LOCATION', async () => {
    setWeatherProvider(new FakeWeatherProvider([]))
    mocks.findCommunity.mockResolvedValue({ ...COMMUNITY, latitude: { toNumber: () => 200 } })

    const result = await service.getWeather('user-1', 'community-1')

    expect(result.meta.reason).toBe('NO_LOCATION')
  })
})

describe('getMap', () => {
  it('siempre devuelve location desde la base de datos', async () => {
    setGeocodingProvider(new FakeGeocodingProvider({ searchNearby: () => [] }))
    mocks.cacheGet.mockResolvedValue(null)

    const result = await service.getMap('user-1', 'community-1')

    expect(result.data.location.city).toBe('Madrid')
    expect(result.data.location.latitude).toBe(40.4168)
  })

  it('proveedor cae: location presente, listas vacias y degraded', async () => {
    setGeocodingProvider(new FakeGeocodingProvider({ searchNearby: () => { throw new ExternalProviderError('boom') } }))
    mocks.cacheGet.mockResolvedValue(null)

    const result = await service.getMap('user-1', 'community-1')

    expect(result.data.location.city).toBe('Madrid')
    expect(result.data.providers).toEqual([])
    expect(result.data.pois).toEqual([])
    expect(result.meta.degraded).toBe(true)
  })
})

describe('geocode', () => {
  it('sin proveedor: 503 EXTERNAL_NOT_CONFIGURED', async () => {
    setGeocodingProvider(null)
    await expect(service.geocode('user-1', 'community-1', 'ADMIN')).rejects.toMatchObject({
      status: 503,
      code: 'EXTERNAL_NOT_CONFIGURED',
    })
  })

  it('sin direccion: 422 GEOCODING_FAILED', async () => {
    setGeocodingProvider(new FakeGeocodingProvider())
    mocks.findCommunity.mockResolvedValue({ ...COMMUNITY, address_line1: '', city: '' })

    await expect(service.geocode('user-1', 'community-1', 'ADMIN')).rejects.toMatchObject({
      status: 422,
      code: 'GEOCODING_FAILED',
    })
  })

  it('proveedor no resuelve: 422', async () => {
    setGeocodingProvider(new FakeGeocodingProvider({ geocode: () => null }))
    mocks.cacheGet.mockResolvedValue(null)

    await expect(service.geocode('user-1', 'community-1', 'ADMIN')).rejects.toMatchObject({
      status: 422,
      code: 'GEOCODING_FAILED',
    })
  })

  it('proveedor cae: 502 EXTERNAL_PROVIDER_ERROR', async () => {
    setGeocodingProvider(new FakeGeocodingProvider({ geocode: () => { throw new ExternalProviderError('boom') } }))
    mocks.cacheGet.mockResolvedValue(null)

    await expect(service.geocode('user-1', 'community-1', 'ADMIN')).rejects.toMatchObject({
      status: 502,
      code: 'EXTERNAL_PROVIDER_ERROR',
    })
  })

  it('resuelve: escribe coordenadas y audita community.geocode', async () => {
    const result: GeocodeResult = { latitude: 40.4, longitude: -3.7, formattedAddress: 'Madrid', source: 'fake' }
    setGeocodingProvider(new FakeGeocodingProvider({ geocode: () => result }))
    mocks.cacheGet.mockResolvedValue(null)

    const out = await service.geocode('user-1', 'community-1', 'ADMIN')

    expect(out).toEqual(result)
    expect(mocks.updateCoordinates).toHaveBeenCalledWith({}, 'community-1', 40.4, -3.7)
    expect(mocks.insertGeocodeAudit).toHaveBeenCalledOnce()
  })
})
