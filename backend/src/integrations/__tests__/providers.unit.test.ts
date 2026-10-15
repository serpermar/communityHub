// ---------------------------------------------------------------------------
// Router de proveedores (spec 12 §6.2, §14).
//
// El entorno de los tests unitarios es `NODE_ENV=test`, asi que el camino por
// defecto es el fake: nunca se sale a la red. Se comprueba tambien que el
// override de los tests funciona y que `resetProviders` vuelve al fake.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it } from 'vitest'
import {
  getGeocodingProvider,
  getWeatherProvider,
  resetProviders,
  setGeocodingProvider,
  setWeatherProvider,
} from '../providers.js'
import { FakeWeatherProvider } from '../weather/fake.js'
import { FakeGeocodingProvider } from '../map/fake.js'

afterEach(() => resetProviders())

describe('seleccion por entorno', () => {
  it('en NODE_ENV=test devuelve fake, nunca el proveedor real', () => {
    expect(getWeatherProvider()).toBeInstanceOf(FakeWeatherProvider)
    expect(getGeocodingProvider()).toBeInstanceOf(FakeGeocodingProvider)
  })

  it('es estable: dos llamadas devuelven la misma instancia', () => {
    expect(getWeatherProvider()).toBe(getWeatherProvider())
  })
})

describe('override de los tests', () => {
  it('setWeatherProvider sustituye la eleccion', () => {
    const fake = new FakeWeatherProvider([])
    setWeatherProvider(fake)
    expect(getWeatherProvider()).toBe(fake)
  })

  it('setWeatherProvider(null) fuerza el modo degradado', () => {
    setWeatherProvider(null)
    setGeocodingProvider(null)
    expect(getWeatherProvider()).toBeNull()
    expect(getGeocodingProvider()).toBeNull()
  })

  it('resetProviders vuelve al fake del entorno de test', () => {
    setWeatherProvider(null)
    expect(getWeatherProvider()).toBeNull()
    resetProviders()
    expect(getWeatherProvider()).toBeInstanceOf(FakeWeatherProvider)
  })
})
