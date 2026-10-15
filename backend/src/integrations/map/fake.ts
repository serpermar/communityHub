// ---------------------------------------------------------------------------
// Proveedor de mapas/geocodificado de mentira para los tests (EXT-5, EXT-13).
//
// Igual que `FakeWeatherProvider`: guiones por funcion y registro de llamadas.
// Aqui hacen falta dos guiones, porque la interfaz tiene dos operaciones
// (`geocode` y `searchNearby`), y cada una tiene su propio registro de llamadas
// para poder afirmar cual se invoco y con que.
//
// Para simular el proveedor caido, cualquiera de los dos guiones puede lanzar
// `ExternalProviderError`.
// ---------------------------------------------------------------------------

import type { GeocodeResult, GeocodingProvider, PlaceView } from '../types.js'

export type GeocodeCall = { address: string }
export type NearbyCall = { latitude: number; longitude: number; radiusM: number; limit: number }

export type FakeGeocodingOptions = {
  geocode?: (input: GeocodeCall) => GeocodeResult | null | Promise<GeocodeResult | null>
  searchNearby?: (input: NearbyCall) => PlaceView[] | Promise<PlaceView[]>
}

export class FakeGeocodingProvider implements GeocodingProvider {
  readonly name = 'fake'

  readonly geocodeCalls: GeocodeCall[] = []
  readonly nearbyCalls: NearbyCall[] = []

  constructor(private readonly options: FakeGeocodingOptions = {}) {}

  async geocode(input: GeocodeCall): Promise<GeocodeResult | null> {
    this.geocodeCalls.push({ address: input.address })

    if (this.options.geocode) return this.options.geocode(input)

    return {
      latitude: 40.4168,
      longitude: -3.7038,
      formattedAddress: input.address,
      source: this.name,
    }
  }

  async searchNearby(input: NearbyCall): Promise<PlaceView[]> {
    this.nearbyCalls.push({
      latitude: input.latitude,
      longitude: input.longitude,
      radiusM: input.radiusM,
      limit: input.limit,
    })

    if (this.options.searchNearby) return this.options.searchNearby(input)

    return []
  }
}
