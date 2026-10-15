// ---------------------------------------------------------------------------
// Error interno del bloque 12.
//
// NO es un error HTTP. `ExternalProviderError` significa "el proveedor externo
// ha fallado de alguna forma prevista" (red, timeout, `!ok`, JSON invalido,
// forma inesperada). Quien decide que hacer con el es el service, y la decision
// depende del endpoint (§6.4):
//
//   - weather / map  -> degradan (200 con datos parciales o nulos). El error NO
//                       sale al cliente como 5xx (EXT-2).
//   - geocode        -> lo traduce a 502 EXTERNAL_PROVIDER_ERROR.
//
// Por eso vive aqui y no en `http/errors.ts`: en el momento en que se lanza,
// todavia no se sabe que codigo HTTP (si alguno) le corresponde.
//
// Se usa el patron de `LLMProviderError` (bloque 11): el `cause` viaja por las
// opciones nativas de `Error`, que es lo que permite conservar el error de red
// original sin inventar una jerarquia.
// ---------------------------------------------------------------------------

export class ExternalProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ExternalProviderError'
  }
}
