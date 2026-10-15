// ---------------------------------------------------------------------------
// Router de proveedores (spec 12 §6.2).
//
// Orden de decision, identico para meteorologia y mapas:
//
//   1. `EXTERNAL_APIS_ENABLED=false` -> `null`. `null` no es un error: es "modo
//      degradado", y el service lo traduce a `meta.reason='DISABLED'` (o a 503
//      en `geocode`). Apagar las integraciones un dia sin cuota no debe obligar
//      a borrar variables ni a desplegar (EXT-13).
//   2. `NODE_ENV=test` -> fake, SIEMPRE. La suite no puede depender de la red ni
//      de un tercero caido (EXT-13, AI-3).
//   3. El proveedor que diga la variable de entorno.
//
// El override (`setWeatherProvider`/`setGeocodingProvider`) existe para los
// tests: sin poder inyectar un fake guionizado, probar la cache y la degradacion
// exigiria salir a la red. `resetProviders()` vuelve a la eleccion por entorno.
// ---------------------------------------------------------------------------

import { env } from '../config/env.js'
import { FakeGeocodingProvider } from './map/fake.js'
import { PhotonProvider } from './map/photon.js'
import type { GeocodingProvider, WeatherProvider } from './types.js'
import { FakeWeatherProvider } from './weather/fake.js'
import { OpenMeteoProvider } from './weather/open-meteo.js'

function buildWeather(): WeatherProvider | null {
  if (!env.EXTERNAL_APIS_ENABLED) return null
  if (env.isTest) return new FakeWeatherProvider()
  if (env.WEATHER_PROVIDER === 'open-meteo') return new OpenMeteoProvider()
  return null
}

function buildGeocoding(): GeocodingProvider | null {
  if (!env.EXTERNAL_APIS_ENABLED) return null
  if (env.isTest) return new FakeGeocodingProvider()
  if (env.MAP_PROVIDER === 'photon') return new PhotonProvider()
  return null
}

// `undefined` = no hay override; `null` = degradado forzado por un test.
let weatherOverride: WeatherProvider | null | undefined
let geocodingOverride: GeocodingProvider | null | undefined
let weatherCached: WeatherProvider | null | undefined
let geocodingCached: GeocodingProvider | null | undefined

export function getWeatherProvider(): WeatherProvider | null {
  if (weatherOverride !== undefined) return weatherOverride
  if (weatherCached === undefined) weatherCached = buildWeather()
  return weatherCached
}

export function getGeocodingProvider(): GeocodingProvider | null {
  if (geocodingOverride !== undefined) return geocodingOverride
  if (geocodingCached === undefined) geocodingCached = buildGeocoding()
  return geocodingCached
}

/** Inyecta un proveedor de meteorologia (tests). `null` fuerza el modo degradado. */
export function setWeatherProvider(provider: WeatherProvider | null): void {
  weatherOverride = provider
}

/** Inyecta un proveedor de mapas (tests). `null` fuerza el modo degradado. */
export function setGeocodingProvider(provider: GeocodingProvider | null): void {
  geocodingOverride = provider
}

/** Vuelve a la eleccion por entorno. */
export function resetProviders(): void {
  weatherOverride = undefined
  geocodingOverride = undefined
  weatherCached = undefined
  geocodingCached = undefined
}
