// ---------------------------------------------------------------------------
// Adaptador de Open-Meteo (spec 12 §5.3, §14).
//
// Se prueba la normalizacion (con su tabla de valores ausentes -> null) y el
// parseo defensivo: si el proveedor devuelve algo inesperado, se lanza
// `ExternalProviderError`, no un TypeError a media normalizacion.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildWeatherUrl, normalizeWeather, OpenMeteoProvider } from '../weather/open-meteo.js'
import { ExternalProviderError } from '../errors.js'

const SAMPLE = {
  latitude: 40.4,
  longitude: -3.7,
  timezone: 'Europe/Madrid',
  utc_offset_seconds: 7200,
  current: {
    time: '2026-10-14T10:00',
    temperature_2m: 21.3,
    apparent_temperature: 20.1,
    is_day: 1,
    weather_code: 61,
  },
  daily: {
    time: ['2026-10-14'],
    weather_code: [61],
    temperature_2m_max: [24.1],
    temperature_2m_min: [14.2],
    precipitation_probability_max: [30],
    sunrise: ['2026-10-14T08:12'],
    sunset: ['2026-10-14T19:04'],
  },
}

afterEach(() => vi.unstubAllGlobals())

describe('normalizeWeather', () => {
  it('traduce una respuesta completa al WeatherReading', () => {
    const reading = normalizeWeather(SAMPLE)

    expect(reading.current).toEqual({
      temperatureC: 21.3,
      apparentTemperatureC: 20.1,
      weatherCode: 61,
      condition: 'RAIN',
      isDay: true,
    })
    expect(reading.today).toEqual({
      minC: 14.2,
      maxC: 24.1,
      precipitationProbability: 30,
      sunrise: '2026-10-14T08:12:00+02:00',
      sunset: '2026-10-14T19:04:00+02:00',
    })
    expect(reading.source).toBe('open-meteo')
    expect(reading.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('is_day llega como 1/0 y se convierte a booleano', () => {
    const night = normalizeWeather({ ...SAMPLE, current: { ...SAMPLE.current, is_day: 0 } })
    expect(night.current.isDay).toBe(false)
  })

  it('los valores ausentes son null, nunca 0', () => {
    const reading = normalizeWeather({
      ...SAMPLE,
      current: { temperature_2m: 5, weather_code: 0 },
      daily: { temperature_2m_min: [1], temperature_2m_max: [2] },
    })

    expect(reading.current.apparentTemperatureC).toBeNull()
    expect(reading.today.precipitationProbability).toBeNull()
    expect(reading.today.sunrise).toBeNull()
    expect(reading.today.sunset).toBeNull()
  })

  it('un codigo WMO desconocido da UNKNOWN', () => {
    const reading = normalizeWeather({ ...SAMPLE, current: { ...SAMPLE.current, weather_code: 9999 } })
    expect(reading.current.condition).toBe('UNKNOWN')
  })

  it('sin el bloque current lanza ExternalProviderError (no TypeError)', () => {
    expect(() => normalizeWeather({ daily: SAMPLE.daily })).toThrow(ExternalProviderError)
    expect(() => normalizeWeather(null)).toThrow(ExternalProviderError)
  })

  it('sin temperatura o codigo lanza ExternalProviderError', () => {
    expect(() => normalizeWeather({ ...SAMPLE, current: { is_day: 1 } })).toThrow(ExternalProviderError)
  })
})

describe('buildWeatherUrl', () => {
  it('incluye coordenadas, zona horaria y un solo dia de previsión', () => {
    const url = buildWeatherUrl({ latitude: 40.4, longitude: -3.7, timezone: 'Europe/Madrid' })
    expect(url).toContain('/v1/forecast?')
    expect(url).toContain('latitude=40.4')
    expect(url).toContain('longitude=-3.7')
    expect(url).toContain('timezone=Europe%2FMadrid')
    expect(url).toContain('forecast_days=1')
  })
})

describe('OpenMeteoProvider', () => {
  it('fetchWeather pide la URL y normaliza la respuesta', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => SAMPLE }) as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    const reading = await new OpenMeteoProvider().fetchWeather({ latitude: 40.4, longitude: -3.7, timezone: 'Europe/Madrid' })

    expect(reading.current.temperatureC).toBe(21.3)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
