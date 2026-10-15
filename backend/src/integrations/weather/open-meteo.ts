// ---------------------------------------------------------------------------
// Adaptador de Open-Meteo (EXT-8).
//
// Traduce la respuesta de `/v1/forecast` al `WeatherReading` interno. No decide
// nada de negocio: no sabe de comunidades ni de cache, solo de HTTP y de JSON
// (ese trabajo lo reparte el service).
//
// El parseo es DEFENSIVO a proposito (§11.5): si el proveedor cambia, faltan
// campos o devuelve basura, se lanza `ExternalProviderError` —que degrada— en
// lugar de dejar caer un `TypeError` a mitad de la normalizacion, que seria un
// 500 (y un 5xx por un tercero esta prohibido por EXT-2).
//
// Decision de valores ausentes (§5.3): lo opcional va a `null`, nunca a `0`. Un
// `0` falso de temperatura o de probabilidad de lluvia es peor que un hueco: el
// frontend no lo puede distinguir de un "cero de verdad". Lo obligatorio
// (temperatura actual y codigo) si falta es un error: sin eso no hay reading.
// ---------------------------------------------------------------------------

import { env } from '../../config/env.js'
import { ExternalProviderError } from '../errors.js'
import { fetchJson } from '../http.js'
import type { WeatherProvider, WeatherReading } from '../types.js'
import { conditionFor } from './normalize.js'

// --- Utilidades de parseo defensivo ------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Numero finito o null. Un `NaN`, una cadena o un objeto no son un numero. */
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * Convierte una hora local de Open-Meteo (`2026-10-14T08:12`) en ISO 8601 con el
 * offset de la comunidad, usando `utc_offset_seconds` de la propia respuesta.
 *
 * Open-Meteo, con `timezone=<zona>`, devuelve la hora en la zona pero SIN el
 * offset. El DTO (§5.1) promete ISO con offset, que es lo que un cliente de
 * fechas entiende sin ambiguedad. Si el valor ya trae `Z` u offset, se respeta.
 */
function withOffset(value: unknown, offsetSeconds: number | null): string | null {
  const raw = str(value)
  if (!raw) return null
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) return raw
  if (offsetSeconds === null) return null

  const sign = offsetSeconds >= 0 ? '+' : '-'
  const abs = Math.abs(offsetSeconds)
  const hours = String(Math.floor(abs / 3_600)).padStart(2, '0')
  const minutes = String(Math.floor((abs % 3_600) / 60)).padStart(2, '0')

  // Si la hora no traia segundos (`2026-10-14T08:12`), se añaden.
  const withSeconds = raw.length === 16 ? `${raw}:00` : raw
  return `${withSeconds}${sign}${hours}:${minutes}`
}

// --- URL ---------------------------------------------------------------------

export function buildWeatherUrl(input: { latitude: number; longitude: number; timezone: string }): string {
  const params = new URLSearchParams({
    latitude: String(input.latitude),
    longitude: String(input.longitude),
    current: 'temperature_2m,apparent_temperature,is_day,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    timezone: input.timezone,
    forecast_days: '1',
  })

  return `${env.OPEN_METEO_BASE_URL}/v1/forecast?${params.toString()}`
}

// --- Normalizacion -----------------------------------------------------------

/** Convierte el JSON de Open-Meteo en un `WeatherReading`. Exportado para los tests. */
export function normalizeWeather(payload: unknown, source = 'open-meteo'): WeatherReading {
  if (!isRecord(payload)) {
    throw new ExternalProviderError('Open-Meteo no ha devuelto un objeto.')
  }

  const current = payload.current
  const daily = payload.daily

  if (!isRecord(current) || !isRecord(daily)) {
    throw new ExternalProviderError('Open-Meteo no ha devuelto los bloques current/daily.')
  }

  const temperature = num(current.temperature_2m)
  const weatherCode = num(current.weather_code)
  const min = num(list(daily.temperature_2m_min)[0])
  const max = num(list(daily.temperature_2m_max)[0])

  if (temperature === null || weatherCode === null || min === null || max === null) {
    throw new ExternalProviderError('Open-Meteo no ha devuelto la temperatura o el codigo esperados.')
  }

  const offset = num(payload.utc_offset_seconds)

  return {
    current: {
      temperatureC: temperature,
      apparentTemperatureC: num(current.apparent_temperature),
      weatherCode,
      condition: conditionFor(weatherCode),
      // `is_day` viene como 1/0, no como booleano.
      isDay: current.is_day === 1,
    },
    today: {
      minC: min,
      maxC: max,
      precipitationProbability: num(list(daily.precipitation_probability_max)[0]),
      sunrise: withOffset(list(daily.sunrise)[0], offset),
      sunset: withOffset(list(daily.sunset)[0], offset),
    },
    updatedAt: new Date().toISOString(),
    source,
  }
}

export class OpenMeteoProvider implements WeatherProvider {
  readonly name = 'open-meteo'

  async fetchWeather(input: {
    latitude: number
    longitude: number
    timezone: string
    signal?: AbortSignal
  }): Promise<WeatherReading> {
    const payload = await fetchJson(buildWeatherUrl(input), { signal: input.signal })
    return normalizeWeather(payload, this.name)
  }
}
