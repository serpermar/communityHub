// ---------------------------------------------------------------------------
// Proveedor de meteorologia de mentira para los tests (EXT-5, EXT-13).
//
// Mismo formato que `FakeLLMClient` (bloque 11): una lista de respuestas
// guionizadas o una funcion que las calcula, y un registro de todas las
// llamadas en `calls`. Permite probar el service (cache, degradacion, DTO) sin
// salir a la red.
//
// Para simular un proveedor CAIDO, el guion puede ser una funcion que lance
// `ExternalProviderError`; es el mismo camino que sigue el adaptador real.
// ---------------------------------------------------------------------------

import type { WeatherProvider, WeatherReading } from '../types.js'

export type WeatherCall = {
  latitude: number
  longitude: number
  timezone: string
}

export type FakeWeatherScript = WeatherReading[] | ((input: WeatherCall) => WeatherReading | Promise<WeatherReading>)

/** Reading por defecto: un dia despejado de temperaturas suaves y valores completos. */
export function defaultReading(): WeatherReading {
  return {
    current: {
      temperatureC: 21,
      apparentTemperatureC: 21,
      weatherCode: 0,
      condition: 'CLEAR',
      isDay: true,
    },
    today: {
      minC: 14,
      maxC: 24,
      precipitationProbability: 0,
      sunrise: '2026-10-14T08:12:00+02:00',
      sunset: '2026-10-14T19:04:00+02:00',
    },
    updatedAt: '2026-10-14T10:00:00.000Z',
    source: 'fake',
  }
}

export class FakeWeatherProvider implements WeatherProvider {
  readonly name = 'fake'

  /** Todas las peticiones recibidas, en orden. */
  readonly calls: WeatherCall[] = []

  private readonly script: FakeWeatherScript
  private queue: WeatherReading[]

  constructor(script: FakeWeatherScript = []) {
    this.script = script
    this.queue = Array.isArray(script) ? [...script] : []
  }

  async fetchWeather(input: WeatherCall): Promise<WeatherReading> {
    this.calls.push({ latitude: input.latitude, longitude: input.longitude, timezone: input.timezone })

    if (typeof this.script === 'function') {
      return this.script(input)
    }

    return this.queue.shift() ?? defaultReading()
  }

  /** Añade una respuesta mas al final de la cola. */
  push(reading: WeatherReading): void {
    this.queue.push(reading)
  }
}
