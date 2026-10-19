import axios, { AxiosError, type AxiosRequestConfig } from 'axios'
import type { ApiEnvelope, ListResult, PaginationMeta } from '@/types/api'
import { ApiError } from './ApiError'
import { getAccessToken, refreshSession } from './session'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1'

export const http = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
})

http.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) config.headers.set('Authorization', `Bearer ${token}`)
  else config.headers.delete('Authorization')
  return config
})

let onSessionExpired: () => void = () => {}
export function setSessionExpiredHandler(handler: () => void): void {
  onSessionExpired = handler
}

interface RetriableConfig extends AxiosRequestConfig {
  _retried?: boolean
}

http.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    const axiosError = error as AxiosError
    const original = axiosError.config as RetriableConfig | undefined
    const status = axiosError.response?.status
    const url = original?.url ?? ''
    const isAuthCall =
      url.includes('/auth/refresh') || url.includes('/auth/login') || url.includes('/auth/register')

    if (status === 401 && original && !isAuthCall && !original._retried) {
      original._retried = true
      const token = await refreshSession()
      if (token) {
        return http.request(original)
      }
      onSessionExpired()
    }

    throw ApiError.from(error)
  },
)

/** Cliente tipado sobre el sobre unico `{ data }`. */
export const api = {
  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await http.get<ApiEnvelope<T>>(url, config)
    return response.data.data
  },

  async list<T, M = PaginationMeta>(
    url: string,
    config?: AxiosRequestConfig,
  ): Promise<ListResult<T, M>> {
    const response = await http.get<ApiEnvelope<T[], M>>(url, config)
    return { data: response.data.data, meta: response.data.meta as M }
  },

  async post<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await http.post<ApiEnvelope<T>>(url, body, config)
    return response.data.data
  },

  async put<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await http.put<ApiEnvelope<T>>(url, body, config)
    return response.data.data
  },

  async patch<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await http.patch<ApiEnvelope<T>>(url, body, config)
    return response.data.data
  },

  async delete<T = void>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await http.delete<ApiEnvelope<T>>(url, config)
    return response.data.data
  },

  async upload<T>(url: string, form: FormData): Promise<T> {
    const response = await http.post<ApiEnvelope<T>>(url, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return response.data.data
  },
}

/**
 * `axios` normaliza `params`; esto descarta claves `undefined` para no enviar
 * `?q=undefined`. Los filtros de los listados lo usan.
 */
export function cleanParams<T extends Record<string, unknown>>(params: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') out[key] = value
  }
  return out as Partial<T>
}
