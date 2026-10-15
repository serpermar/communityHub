// ---------------------------------------------------------------------------
// Normalizacion WMO -> condicion -> etiqueta (spec 12 §5.3, §14).
//
// La tabla entera, codigo a codigo, para que un cambio de criterio no pase
// inadvertido: si alguien mete el 80 en "lluvia" en vez de en "chubascos", aqui
// salta. Y el caso que importa de verdad: un codigo que no esta en la tabla NO
// se adivina, se dice UNKNOWN.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import { conditionFor, conditionLabel } from '../weather/normalize.js'

describe('conditionFor', () => {
  it('mapea cada codigo WMO a su condicion', () => {
    const table: Array<[number, string]> = [
      [0, 'CLEAR'],
      [1, 'MAINLY_CLEAR'],
      [2, 'PARTLY_CLOUDY'],
      [3, 'OVERCAST'],
      [45, 'FOG'],
      [48, 'FOG'],
      [51, 'DRIZZLE'],
      [53, 'DRIZZLE'],
      [55, 'DRIZZLE'],
      [56, 'FREEZING_RAIN'],
      [57, 'FREEZING_RAIN'],
      [61, 'RAIN'],
      [63, 'RAIN'],
      [65, 'RAIN'],
      [66, 'FREEZING_RAIN'],
      [67, 'FREEZING_RAIN'],
      [71, 'SNOW'],
      [73, 'SNOW'],
      [75, 'SNOW'],
      [77, 'SNOW'],
      [80, 'RAIN_SHOWERS'],
      [81, 'RAIN_SHOWERS'],
      [82, 'RAIN_SHOWERS'],
      [85, 'SNOW_SHOWERS'],
      [86, 'SNOW_SHOWERS'],
      [95, 'THUNDERSTORM'],
      [96, 'THUNDERSTORM'],
      [99, 'THUNDERSTORM'],
    ]

    for (const [code, expected] of table) {
      expect(conditionFor(code), `codigo ${code}`).toBe(expected)
    }
  })

  it('un codigo desconocido es UNKNOWN, no una condicion parecida', () => {
    expect(conditionFor(1234)).toBe('UNKNOWN')
    expect(conditionFor(-1)).toBe('UNKNOWN')
  })

  it('el codigo 80 es chubascos, no lluvia', () => {
    expect(conditionFor(80)).toBe('RAIN_SHOWERS')
    expect(conditionFor(61)).toBe('RAIN')
  })
})

describe('conditionLabel', () => {
  it('da una etiqueta en castellano a cada condicion', () => {
    expect(conditionLabel('CLEAR')).toBe('Despejado')
    expect(conditionLabel('THUNDERSTORM')).toBe('Tormenta')
  })

  it('UNKNOWN tiene etiqueta y no queda vacia', () => {
    expect(conditionLabel('UNKNOWN')).toBe('Desconocido')
  })
})
