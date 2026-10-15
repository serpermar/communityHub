// ---------------------------------------------------------------------------
// Validacion de payloads de cache (spec 12 §11.13, validators.ts de §12).
//
// La cache es un JSONB que sobrevive a los despliegues. Si el dia que cambia el
// DTO alguien lee una entrada escrita por la version anterior, el `JSON.parse`
// no falla: devuelve un objeto con la forma vieja, y el error aparece mas tarde
// (o, peor, no aparece y se sirve un DTO a medias a un vecino).
//
// Por eso TODO lo que sale de la cache pasa por un esquema zod antes de usarse.
// Si no encaja, se trata como "no hay cache" y se refresca contra el proveedor.
// Es la misma idea que el `parseToolArguments` defensivo del bloque 11, aplicada
// a la frontera de la tabla.
//
// No hay schemas de entrada para los endpoints del bloque: `weather`/`map` no
// reciben query ni cuerpo y `geocode` usa la direccion guardada (§7).
// ---------------------------------------------------------------------------

import { z } from 'zod'
import type { GeocodeResult, MapPayload, WeatherReading } from './types.js'

const condition = z.enum([
  'CLEAR',
  'MAINLY_CLEAR',
  'PARTLY_CLOUDY',
  'OVERCAST',
  'FOG',
  'DRIZZLE',
  'RAIN',
  'FREEZING_RAIN',
  'SNOW',
  'RAIN_SHOWERS',
  'SNOW_SHOWERS',
  'THUNDERSTORM',
  'UNKNOWN',
])

export const weatherReadingSchema = z.object({
  current: z.object({
    temperatureC: z.number(),
    apparentTemperatureC: z.number().nullable(),
    weatherCode: z.number(),
    condition,
    isDay: z.boolean(),
  }),
  today: z.object({
    minC: z.number(),
    maxC: z.number(),
    precipitationProbability: z.number().nullable(),
    sunrise: z.string().nullable(),
    sunset: z.string().nullable(),
  }),
  updatedAt: z.string(),
  source: z.string(),
})

export const placeViewSchema = z.object({
  name: z.string(),
  category: z.string(),
  osmKey: z.string(),
  osmValue: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  distanceM: z.number(),
  address: z.string().nullable(),
})

export const mapPayloadSchema = z.object({
  places: z.array(placeViewSchema),
  updatedAt: z.string(),
  source: z.string(),
})

export const geocodeResultSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  formattedAddress: z.string().nullable(),
  source: z.string(),
})

/** Devuelve un `WeatherReading`, o `null` si el payload cacheado no encaja. */
export function asWeatherReading(payload: unknown): WeatherReading | null {
  const result = weatherReadingSchema.safeParse(payload)
  return result.success ? (result.data as WeatherReading) : null
}

/** Devuelve un `MapPayload`, o `null` si el payload cacheado no encaja. */
export function asMapPayload(payload: unknown): MapPayload | null {
  const result = mapPayloadSchema.safeParse(payload)
  return result.success ? (result.data as MapPayload) : null
}

/** Devuelve un `GeocodeResult`, o `null` si el payload cacheado no encaja. */
export function asGeocodeResult(payload: unknown): GeocodeResult | null {
  const result = geocodeResultSchema.safeParse(payload)
  return result.success ? (result.data as GeocodeResult) : null
}
