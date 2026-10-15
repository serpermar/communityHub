// ---------------------------------------------------------------------------
// Normalizacion de meteorologia (spec 12 §5.3).
//
// Traduce el codigo WMO crudo de Open-Meteo a `WeatherCondition` y de ahi a una
// etiqueta en castellano. La tabla es EXPLICITA, codigo a codigo, y no una
// heuristica de rangos: los codigos WMO no son un contador continuo (el 45 y el
// 48 son niebla, el 51..57 llovizna, el 61..67 lluvia, el 71..77 nieve, el
// 80..82 chubascos de lluvia, el 85..86 de nieve, el 95..99 tormenta), y una
// regla de rangos acaba metiendo el 80 en "lluvia" cuando es un chubasco.
//
// Codigo desconocido -> UNKNOWN. No se inventa una condicion "parecida": si el
// proveedor añade un codigo nuevo, lo correcto es decirlo, no adivinar.
//
// La etiqueta en castellano NO viaja en el DTO (el DTO lleva la condicion
// normalizada, que es lo que el frontend mapea a icono). Se mantiene aqui
// porque es la otra mitad de la tabla y porque las pruebas la verifican
// (§14): "cada codigo -> condicion + etiqueta".
// ---------------------------------------------------------------------------

import type { WeatherCondition } from '../types.js'

const WMO_TO_CONDITION: Readonly<Record<number, WeatherCondition>> = {
  0: 'CLEAR',
  1: 'MAINLY_CLEAR',
  2: 'PARTLY_CLOUDY',
  3: 'OVERCAST',
  45: 'FOG',
  48: 'FOG',
  51: 'DRIZZLE',
  53: 'DRIZZLE',
  55: 'DRIZZLE',
  56: 'FREEZING_RAIN',
  57: 'FREEZING_RAIN',
  61: 'RAIN',
  63: 'RAIN',
  65: 'RAIN',
  66: 'FREEZING_RAIN',
  67: 'FREEZING_RAIN',
  71: 'SNOW',
  73: 'SNOW',
  75: 'SNOW',
  77: 'SNOW',
  80: 'RAIN_SHOWERS',
  81: 'RAIN_SHOWERS',
  82: 'RAIN_SHOWERS',
  85: 'SNOW_SHOWERS',
  86: 'SNOW_SHOWERS',
  95: 'THUNDERSTORM',
  96: 'THUNDERSTORM',
  99: 'THUNDERSTORM',
}

const LABELS: Readonly<Record<WeatherCondition, string>> = {
  CLEAR: 'Despejado',
  MAINLY_CLEAR: 'Mayormente despejado',
  PARTLY_CLOUDY: 'Parcialmente nublado',
  OVERCAST: 'Cubierto',
  FOG: 'Niebla',
  DRIZZLE: 'Llovizna',
  RAIN: 'Lluvia',
  FREEZING_RAIN: 'Lluvia helada',
  SNOW: 'Nieve',
  RAIN_SHOWERS: 'Chubascos',
  SNOW_SHOWERS: 'Chubascos de nieve',
  THUNDERSTORM: 'Tormenta',
  UNKNOWN: 'Desconocido',
}

/** Codigo WMO -> condicion normalizada. Desconocido -> UNKNOWN. */
export function conditionFor(code: number): WeatherCondition {
  return WMO_TO_CONDITION[code] ?? 'UNKNOWN'
}

/** Condicion normalizada -> etiqueta en castellano. */
export function conditionLabel(condition: WeatherCondition): string {
  return LABELS[condition]
}
