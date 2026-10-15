// ---------------------------------------------------------------------------
// Tipos del bloque 12 (spec 12 §5, §6.1).
//
// Dos grupos:
//
//   1. Los DTOs que viajan al frontend (`WeatherView`, `MapView`, `PlaceView`,
//      `GeocodeResult`). Son el contrato de la API y no conocen al proveedor
//      (EXT-1): el frontend nunca ve un `WeatherCondition` crudo ni un `osm_key`
//      sin etiquetar sin que venga ya normalizado.
//
//   2. Las interfaces de proveedor (`WeatherProvider`, `GeocodingProvider`).
//      Viven aqui, y no en `providers.ts`, para que los adaptadores puedan
//      importarlas sin crear un ciclo con el router (mismo motivo por el que el
//      bloque 11 tiene `llm/client.ts` aparte de `llm/router.ts`).
//
// Sobre `WeatherReading`: es lo que devuelve un proveedor y, a la vez, el
// payload que se cachea. Es un `WeatherView` SIN el bloque `location`, a
// proposito. `location.city` es dato de la comunidad, no del proveedor, y la
// clave de cache (`weather:<lat>,<lon>:<tz>`) no incluye la ciudad: dos
// comunidades con las mismas coordenadas redondeadas comparten entrada, y si la
// ciudad viajara dentro del payload cacheado, la segunda recibiria el nombre de
// la primera. El service añade `location` al servir (§5.3), no el proveedor.
// ---------------------------------------------------------------------------

/** Condición normalizada de la meteorología (§5.3). Código WMO desconocido -> UNKNOWN. */
export type WeatherCondition =
  | 'CLEAR'
  | 'MAINLY_CLEAR'
  | 'PARTLY_CLOUDY'
  | 'OVERCAST'
  | 'FOG'
  | 'DRIZZLE'
  | 'RAIN'
  | 'FREEZING_RAIN'
  | 'SNOW'
  | 'RAIN_SHOWERS'
  | 'SNOW_SHOWERS'
  | 'THUNDERSTORM'
  | 'UNKNOWN'

export type WeatherCurrent = {
  temperatureC: number
  apparentTemperatureC: number | null
  weatherCode: number
  condition: WeatherCondition
  isDay: boolean
}

export type WeatherToday = {
  minC: number
  maxC: number
  precipitationProbability: number | null
  /** ISO 8601 con el offset de la zona de la comunidad, o null si el proveedor no lo trae. */
  sunrise: string | null
  sunset: string | null
}

/** Lo que produce un proveedor de meteorología y lo que se guarda en caché. */
export type WeatherReading = {
  current: WeatherCurrent
  today: WeatherToday
  /** ISO: cuándo se obtuvo del proveedor. */
  updatedAt: string
  source: string
}

/** El DTO de la API: el reading más la ubicación, que aporta el service. */
export type WeatherView = WeatherReading & {
  location: {
    city: string
    latitude: number
    longitude: number
    timezone: string
  }
}

export type PlaceView = {
  name: string
  /** Etiqueta en castellano (EXT-12), no el `osm_value` crudo. */
  category: string
  osmKey: string
  osmValue: string
  latitude: number
  longitude: number
  /** Haversine desde la comunidad, redondeado a metros. */
  distanceM: number
  address: string | null
}

export type MapLocation = {
  addressLine1: string
  city: string
  province: string | null
  postalCode: string | null
  country: string
  /** null mientras la comunidad no se ha geocodificado. */
  latitude: number | null
  longitude: number | null
  timezone: string
}

export type MapView = {
  location: MapLocation
  providers: PlaceView[]
  pois: PlaceView[]
  /** ISO de la obtención del proveedor; null si venía de caché sin fecha o degradó. */
  updatedAt: string | null
  source: string
}

/** Lo que se guarda en caché para el mapa (los POIs ya clasificados y en orden). */
export type MapPayload = {
  places: PlaceView[]
  updatedAt: string
  source: string
}

export type GeocodeResult = {
  latitude: number
  longitude: number
  formattedAddress: string | null
  source: string
}

/** Por qué un endpoint degradó (EXT-2, §6.4). */
export type DegradeReason = 'NO_LOCATION' | 'PROVIDER_ERROR' | 'DISABLED'

export type WeatherProvider = {
  readonly name: string
  fetchWeather(input: {
    latitude: number
    longitude: number
    timezone: string
    signal?: AbortSignal
  }): Promise<WeatherReading>
}

export type GeocodingProvider = {
  readonly name: string
  geocode(input: { address: string; signal?: AbortSignal }): Promise<GeocodeResult | null>
  searchNearby(input: {
    latitude: number
    longitude: number
    radiusM: number
    limit: number
    signal?: AbortSignal
  }): Promise<PlaceView[]>
}
