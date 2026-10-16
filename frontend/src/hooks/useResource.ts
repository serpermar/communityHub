import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '@/services/ApiError'

export interface ResourceState<T> {
  data: T | null
  loading: boolean
  error: ApiError | null
  reload: () => void
}

/**
 * Estado de un recurso de servidor (decision FE-6): carga, error y recarga
 * manual, sin una libreria de cache. La invalidacion tras una mutacion la hace
 * quien muta, llamando a `reload`.
 */
export function useResource<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[],
): ResourceState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const requestId = useRef(0)

  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const reload = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    setError(null)
    try {
      const result = await fetcherRef.current()
      if (requestId.current === id) setData(result)
    } catch (caught) {
      if (requestId.current === id) setError(ApiError.from(caught))
    } finally {
      if (requestId.current === id) setLoading(false)
    }
  }, [])

  // El fetcher cambia con las dependencias declaradas por el llamante.
  useEffect(() => {
    void reload()
  }, [reload, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error, reload }
}
