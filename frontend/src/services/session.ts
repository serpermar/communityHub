import axios from 'axios'

/**
 * La sesion del cliente (decisiones FE-2bis y FE-3).
 *
 * El access token vive **solo en memoria**; el refresh token es una cookie
 * `httpOnly` que el backend gestiona y este modulo nunca toca. Un unico
 * `refreshSession` en vuelo evita que N peticiones concurrentes disparen N
 * rotaciones de refresh (que el backend interpretaria como reuso y revocaria).
 */
const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1'

let accessToken: string | null = null
let refreshing: Promise<string | null> | null = null
const listeners = new Set<(token: string | null) => void>()

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
  for (const listener of listeners) listener(token)
}

export function subscribeAccessToken(listener: (token: string | null) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Renueva la sesion usando la cookie de refresh. Devuelve el nuevo access token
 * o `null` si no hay sesion valida. Usa un axios propio para no recursar en el
 * interceptor de 401.
 */
export function refreshSession(): Promise<string | null> {
  if (!refreshing) {
    refreshing = axios
      .post<{ data: { accessToken: string } }>(
        `${BASE_URL}/auth/refresh`,
        {},
        { withCredentials: true },
      )
      .then((response) => {
        const token = response.data?.data?.accessToken ?? null
        setAccessToken(token)
        return token
      })
      .catch(() => {
        setAccessToken(null)
        return null
      })
      .finally(() => {
        refreshing = null
      })
  }
  return refreshing
}
