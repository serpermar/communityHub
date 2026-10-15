// ---------------------------------------------------------------------------
// Cache externa (spec 12 §5.2, EXT-3, EXT-4).
//
// Dos responsabilidades, y solo dos:
//
//   1. La CLAVE de cada recurso, que es una funcion pura y por eso se prueba
//      sin base de datos (`sha256('weather:' + round(lat,4) + ',' + ...)`).
//   2. El acceso a `app_external_cache_get/put`, que son las UNICAS funciones
//      que `app_runtime` puede ejecutar: sobre la tabla `external_cache` no
//      tiene ningun privilegio (02_rls.sql §7).
//
// Por que `sha256` en la clave: la de geocodificado se construye a partir de una
// direccion, que es dato personal. Guardarla en claro en una tabla que sobrevive
// a la peticion seria meter el domicilio de un vecino en un sitio mas del que
// hay que acordarse al borrar. El hash no impide la correlacion (misma
// direccion, mismo hash), pero al menos no deja el texto.
//
// Redondear a 4 decimales (~11 m) es la otra decision de §5.2: agrupa
// comunidades vecinas en la misma entrada sin que el dato cambie de forma
// perceptible, y multiplica el acierto de cache en una ciudad densa.
//
// `get` devuelve la fila AUNQUE este caducada, con `isFresh` aparte: es lo que
// permite el stale-while-error (EXT-4). La logica de "que hacer con una entrada
// caducada" no esta aqui, esta en el service; aqui solo se le da el dato.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto'
import { type Prisma } from '@prisma/client'
import { env } from '../config/env.js'

type Tx = Prisma.TransactionClient

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** ~11 m de precision: agrupa comunidades vecinas sin deformar el dato. */
export function roundCoordinate(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

export function weatherCacheKey(input: { latitude: number; longitude: number; timezone: string }): string {
  const lat = roundCoordinate(input.latitude)
  const lon = roundCoordinate(input.longitude)
  return sha256(`weather:${lat},${lon}:${input.timezone}`)
}

export function mapCacheKey(input: { latitude: number; longitude: number; radiusM: number; limit: number }): string {
  const lat = roundCoordinate(input.latitude)
  const lon = roundCoordinate(input.longitude)
  return sha256(`map:${lat},${lon}:${input.radiusM}:${input.limit}`)
}

/**
 * La direccion se normaliza (trim, minusculas, espacios colapsados) antes de
 * hashear: "Calle Mayor 1" y "calle  mayor   1" son la misma coordenada y no
 * tiene sentido pagar dos veces por resolverlas.
 */
export function geocodeCacheKey(address: string): string {
  const normalized = address.trim().toLowerCase().replace(/\s+/g, ' ')
  return sha256(`geo:${normalized}`)
}

/** Traduce los TTL de env a segundos, que es lo que espera la funcion SQL. */
export const weatherTtlSeconds = (): number => env.WEATHER_CACHE_TTL_MINUTES * 60
export const mapTtlSeconds = (): number => env.MAP_CACHE_TTL_MINUTES * 60
export const geocodeTtlSeconds = (): number => env.GEOCODE_CACHE_TTL_HOURS * 3_600

export type CachedEntry = {
  payload: unknown
  expiresAt: Date
  isFresh: boolean
}

/**
 * Lee una entrada. Devuelve `null` si no hay ninguna. Si la hay pero caduco,
 * `isFresh` es `false` y el payload sigue disponible (stale-while-error).
 */
export async function cacheGet(tx: Tx, key: string): Promise<CachedEntry | null> {
  const rows = await tx.$queryRaw<Array<{ payload: unknown; expires_at: Date; is_fresh: boolean }>>`
    select payload, expires_at, is_fresh
      from app_external_cache_get(${key}::text)
  `

  const row = rows[0]
  if (!row) return null

  return { payload: row.payload, expiresAt: row.expires_at, isFresh: row.is_fresh }
}

/**
 * Escribe una entrada con su TTL. Va por `$executeRaw` y no `$queryRaw`: la
 * funcion es `void` y Prisma no sabe deserializar esa columna (la leccion del
 * bloque 11). Ademas `app_external_cache_put` es `VOLATILE`, y llamarla dentro
 * de una funcion `STABLE` daria 0A000.
 */
export async function cachePut(
  tx: Tx,
  input: { key: string; provider: string; payload: unknown; ttlSeconds: number },
): Promise<void> {
  await tx.$executeRaw`
    select app_external_cache_put(
      ${input.key}::text,
      ${input.provider}::text,
      ${JSON.stringify(input.payload)}::jsonb,
      ${input.ttlSeconds}::integer
    )
  `
}
