// ---------------------------------------------------------------------------
// HTTP saliente del bloque 12 (§6.3, EXT-6).
//
// Un solo sitio para TODA la red del bloque. Los adaptadores (open-meteo,
// photon) no ven `fetch` ni `Response`: piden un JSON y este archivo convierte
// CUALQUIER fallo — red caida, timeout, `!ok`, cuerpo que no es JSON — en un
// `ExternalProviderError`. Asi el service solo tiene una cosa que capturar, y no
// se le escapa un `TypeError` a media normalizacion (§11.5).
//
// Sin SDK (D-02, EXT-6): `fetch` nativo de Node 20. Open-Meteo y Photon son
// HTTP/JSON plano, y una dependencia por proveedor ata el codigo a algo que
// cambia sin avisar.
//
// El timeout se aplica con `AbortSignal.timeout`, que aborta la peticion entera
// (conexion incluida) y no solo la lectura. Si quien llama pasa su propio
// `signal` (los tests), ese manda: no se combinan, porque combinar dos senales
// con `AbortSignal.any` añade una version de Node como requisito sin resolver
// nada que aqui haga falta.
// ---------------------------------------------------------------------------

import { env } from '../config/env.js'
import { ExternalProviderError } from './errors.js'

export type FetchJsonOptions = {
  /** Sustituye al timeout por defecto; lo usan los tests. */
  signal?: AbortSignal
  /** Timeout en ms. Por defecto, `EXTERNAL_HTTP_TIMEOUT_MS`. */
  timeoutMs?: number
}

/**
 * Pide `url` y devuelve el JSON ya parseado, o lanza `ExternalProviderError`.
 *
 * `Accept: application/json` y el `User-Agent` identificativo van en todas las
 * peticiones (EXT-7): Photon/OSM lo piden en su politica de uso.
 */
export async function fetchJson(url: string, options: FetchJsonOptions = {}): Promise<unknown> {
  const signal =
    options.signal ?? AbortSignal.timeout(options.timeoutMs ?? env.EXTERNAL_HTTP_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': env.EXTERNAL_USER_AGENT,
      },
      signal,
    })
  } catch (cause) {
    // Aqui caen timeout (AbortError) y fallos de red. Se unifican a proposito:
    // desde el punto de vista del service, "tardo demasiado" y "no hay
    // conexion" son el mismo caso (degradar / 502).
    throw new ExternalProviderError('No se ha podido contactar con el proveedor externo.', {
      cause,
    })
  }

  if (!response.ok) {
    throw new ExternalProviderError(`El proveedor externo ha respondido ${response.status}.`)
  }

  try {
    return (await response.json()) as unknown
  } catch (cause) {
    throw new ExternalProviderError(
      'El proveedor externo ha devuelto una respuesta que no es JSON.',
      { cause },
    )
  }
}
