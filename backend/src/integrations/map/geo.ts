// ---------------------------------------------------------------------------
// Distancias y armado de la lista de lugares (EXT-11, §5.4).
//
// Photon NO filtra por radio: con `lat`/`lon` sesga por cercania y devuelve los
// `limit` mas proximos, que pueden estar a 20 km. El radio de verdad lo
// aplicamos aqui, con haversine, y de ahi salen las tres garantias del bloque:
//
//   1. Solo entran lugares dentro de `MAP_SEARCH_RADIUS_M`.
//   2. Van ordenados por distancia ascendente.
//   3. Se recortan a `MAP_MAX_RESULTS`.
//
// Haversine y no distancia euclidea sobre grados: un grado de longitud no mide
// lo mismo en Madrid que en el norte, y "el proveedor esta a 200 m" no puede
// depender de la latitud. La Tierra se aproxima por una esfera de radio medio,
// que para distancias urbanas tiene un error despreciable.
// ---------------------------------------------------------------------------

import { classify } from './categories.js'
import type { PlaceView } from '../types.js'

const EARTH_RADIUS_M = 6_371_000

export type Coordinates = {
  latitude: number
  longitude: number
}

/** Distancia en metros entre dos puntos, por haversine. */
export function haversineMeters(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180

  const dLat = toRad(b.latitude - a.latitude)
  const dLon = toRad(b.longitude - a.longitude)

  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Un lugar tal y como sale del proveedor, antes de clasificar y medir. */
export type RawPlace = {
  name: string
  osmKey: string
  osmValue: string
  latitude: number
  longitude: number
  address: string | null
}

/**
 * Filtra por radio, clasifica, ordena por cercania y recorta. Es puro: se prueba
 * sin red y sin base de datos.
 */
export function buildPlaceViews(
  raw: readonly RawPlace[],
  origin: Coordinates,
  radiusM: number,
  limit: number,
): PlaceView[] {
  return raw
    .map((place) => ({
      place,
      distanceM: haversineMeters(origin, { latitude: place.latitude, longitude: place.longitude }),
    }))
    .filter(({ distanceM }) => distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit)
    .map(({ place, distanceM }) => {
      const { category } = classify(place.osmKey, place.osmValue)
      return {
        name: place.name,
        category,
        osmKey: place.osmKey,
        osmValue: place.osmValue,
        latitude: place.latitude,
        longitude: place.longitude,
        distanceM: Math.round(distanceM),
        address: place.address,
      }
    })
}
