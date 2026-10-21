import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

type FilterSpec = Record<string, readonly string[] | undefined>

interface UrlFiltersOptions {
  /** Tamanos de pagina permitidos en `?pageSize=`. Sin esto no se persiste. */
  pageSizeOptions?: readonly number[]
  /** Tamano de pagina por defecto. */
  defaultPageSize?: number
}

/**
 * Sincroniza los filtros de una lista con la query string de la URL, para que
 * el estado sobreviva a recargas y a compartir el enlace (antes vivia solo en
 * `useState` y se perdia al recargar).
 *
 * - Los valores permitidos se declaran por filtro (`spec`): un valor fuera de la
 *   lista se ignora y cae al por defecto, de modo que un enlace manipulado no
 *   rompe la pantalla.
 * - La pagina es un `?page=` numerico (>= 1).
 * - Cambiar un filtro resetea la pagina a 1.
 *
 * @example
 * const { filters, page, setFilter, setPage, reset } = useUrlFilters({
 *   status: INCIDENT_STATUSES,
 *   priority: INCIDENT_PRIORITIES,
 * })
 * filters.status // string | '' (vacio = sin filtrar)
 */
export function useUrlFilters(spec: FilterSpec, options: UrlFiltersOptions = {}) {
  const [params, setParams] = useSearchParams()

  const filters: Record<string, string> = {}
  for (const [key, allowed] of Object.entries(spec)) {
    const raw = params.get(key) ?? ''
    filters[key] = !allowed || raw === '' || allowed.includes(raw) ? raw : ''
  }

  const rawPage = Number(params.get('page'))
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1

  const { pageSizeOptions } = options
  const defaultPageSize = options.defaultPageSize ?? pageSizeOptions?.[0] ?? 0
  const rawPageSize = Number(params.get('pageSize'))
  const pageSize = pageSizeOptions
    ? pageSizeOptions.includes(rawPageSize)
      ? rawPageSize
      : defaultPageSize
    : defaultPageSize

  const update = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          mutate(next)
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const setFilter = useCallback(
    (key: string, value: string) => {
      update((next) => {
        if (value) next.set(key, value)
        else next.delete(key)
        next.delete('page')
      })
    },
    [update],
  )

  const setPage = useCallback(
    (value: number) => {
      update((next) => {
        if (value > 1) next.set('page', String(value))
        else next.delete('page')
      })
    },
    [update],
  )

  const setPageSize = useCallback(
    (value: number) => {
      update((next) => {
        if (pageSizeOptions && value !== defaultPageSize) next.set('pageSize', String(value))
        else next.delete('pageSize')
        next.delete('page')
      })
    },
    [update, pageSizeOptions, defaultPageSize],
  )

  const reset = useCallback(() => {
    update((next) => {
      for (const key of Object.keys(spec)) next.delete(key)
      next.delete('page')
      next.delete('pageSize')
    })
    // `spec` es un objeto literal estable por pagina (mapas module-level);
    // incluido para no capturar una version obsoleta.
  }, [update, spec])

  return { filters, page, pageSize, setFilter, setPage, setPageSize, reset }
}
