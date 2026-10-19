// ---------------------------------------------------------------------------
// Clasificacion de POIs (spec 12 §5.4, §14).
//
// Lo que se comprueba: que un oficio o una tienda de reparacion cae en
// `provider`, que el resto cae en `poi`, que la etiqueta es castellano, y que lo
// desconocido NO se inventa: va a `Otro`/`poi`.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import { classify } from '../map/categories.js'

describe('classify', () => {
  it('reconoce proveedores por key+value', () => {
    expect(classify('shop', 'hardware')).toEqual({ category: 'Ferretería', kind: 'provider' })
    expect(classify('craft', 'plumber')).toEqual({ category: 'Fontanería', kind: 'provider' })
    expect(classify('amenity', 'pharmacy')).toEqual({ category: 'Farmacia', kind: 'provider' })
    expect(classify('shop', 'car_repair')).toEqual({
      category: 'Taller mecánico',
      kind: 'provider',
    })
  })

  it('reconoce POIs por key+value', () => {
    expect(classify('leisure', 'park')).toEqual({ category: 'Parque', kind: 'poi' })
    expect(classify('amenity', 'school')).toEqual({ category: 'Educación', kind: 'poi' })
    expect(classify('shop', 'supermarket')).toEqual({ category: 'Supermercado', kind: 'poi' })
    expect(classify('highway', 'bus_stop')).toEqual({ category: 'Transporte', kind: 'poi' })
  })

  it('un value desconocido cae en la regla de la key sola', () => {
    // `leisure=cinema` no tiene regla exacta, pero `leisure` si tiene respaldo.
    expect(classify('leisure', 'cinema')).toEqual({ category: 'Ocio', kind: 'poi' })
    expect(classify('shop', 'paint')).toEqual({ category: 'Comercio', kind: 'poi' })
  })

  it('lo totalmente desconocido es Otro y va a pois, nunca a proveedores', () => {
    expect(classify('weird_key', 'weird_value')).toEqual({ category: 'Otro', kind: 'poi' })
    expect(classify('', '')).toEqual({ category: 'Otro', kind: 'poi' })
  })

  it('normaliza mayusculas y espacios', () => {
    expect(classify(' SHOP ', ' Hardware ')).toEqual({ category: 'Ferretería', kind: 'provider' })
  })
})
