// ---------------------------------------------------------------------------
// HTTP saliente: timeout y traduccion de fallos (spec 12 §6.3, §14).
//
// Se stubea `globalThis.fetch` (no se mockea el modulo): lo que se comprueba es
// que CUALQUIER forma de fallo —red caida, `!ok`, cuerpo no-JSON, timeout—
// llega como `ExternalProviderError` y nunca como un error crudo. Es la frontera
// que impide que un 5xx de un tercero se convierta en un 500 del backend.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchJson } from '../http.js'
import { ExternalProviderError } from '../errors.js'

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchJson', () => {
  it('devuelve el JSON cuando la respuesta es correcta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ ok: true })),
    )
    await expect(fetchJson('https://proveedor.test/x')).resolves.toEqual({ ok: true })
  })

  it('manda Accept y un User-Agent identificativo', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    await fetchJson('https://proveedor.test/x')

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers.Accept).toBe('application/json')
    expect(headers['User-Agent']).toBeTruthy()
  })

  it('un !ok es ExternalProviderError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({}, 503)),
    )
    await expect(fetchJson('https://proveedor.test/x')).rejects.toBeInstanceOf(
      ExternalProviderError,
    )
  })

  it('un cuerpo que no es JSON es ExternalProviderError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            json: async () => {
              throw new Error('boom')
            },
          }) as unknown as Response,
      ),
    )
    await expect(fetchJson('https://proveedor.test/x')).rejects.toBeInstanceOf(
      ExternalProviderError,
    )
  })

  it('un fallo de red es ExternalProviderError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    )
    await expect(fetchJson('https://proveedor.test/x')).rejects.toBeInstanceOf(
      ExternalProviderError,
    )
  })

  it('un timeout aborta y es ExternalProviderError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            })
          }),
      ),
    )

    await expect(fetchJson('https://proveedor.test/x', { timeoutMs: 10 })).rejects.toBeInstanceOf(
      ExternalProviderError,
    )
  })
})
