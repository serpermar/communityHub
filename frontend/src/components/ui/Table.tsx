import { useMemo, useState, type ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { Button } from './Button'

export interface Column<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  className?: string
  /** Habilita el orden por esta columna al pulsar su cabecera. */
  sortable?: boolean
  /** Clave de orden; por defecto se intenta a partir de `render` (string). */
  sortValue?: (row: T) => string | number
}

type SortDirection = 'asc' | 'desc'
interface SortState {
  key: string
  direction: SortDirection
}

/** Compara dos valores de forma estable y consciente de acentos/case. */
function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a ?? '').localeCompare(String(b ?? ''), 'es', { sensitivity: 'base' })
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  selectable,
  selectedKeys,
  onSelectionChange,
  initialSort,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  empty?: ReactNode
  /** Muestra una columna de seleccion con checkboxes. */
  selectable?: boolean
  /** Claves seleccionadas (controlado). */
  selectedKeys?: string[]
  /** Notifica el nuevo conjunto de claves seleccionadas. */
  onSelectionChange?: (keys: string[]) => void
  /** Orden inicial (no controlado). */
  initialSort?: SortState
}) {
  const [sort, setSort] = useState<SortState | null>(initialSort ?? null)

  const sortedRows = useMemo(() => {
    if (!sort) return rows
    const column = columns.find((candidate) => candidate.key === sort.key)
    if (!column) return rows
    const valueOf = (row: T): string | number =>
      column.sortValue ? column.sortValue(row) : extractText(column.render(row))
    const factor = sort.direction === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => compare(valueOf(a), valueOf(b)) * factor)
  }, [rows, columns, sort])

  const toggleSort = (key: string) => {
    setSort((current) => {
      if (current?.key !== key) return { key, direction: 'asc' }
      if (current.direction === 'asc') return { key, direction: 'desc' }
      return null
    })
  }

  const keys = sortedRows.map(rowKey)
  const selected = selectedKeys ?? []
  const allSelected = keys.length > 0 && keys.every((key) => selected.includes(key))

  const toggleAll = () => {
    if (!onSelectionChange) return
    onSelectionChange(allSelected ? [] : keys)
  }

  const toggleRow = (key: string) => {
    if (!onSelectionChange) return
    onSelectionChange(
      selected.includes(key) ? selected.filter((value) => value !== key) : [...selected, key],
    )
  }

  if (rows.length === 0 && empty) return <>{empty}</>

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {selectable && (
              <th className="w-10 px-3 py-2 font-medium">
                <input
                  type="checkbox"
                  aria-label="Seleccionar todo"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-600"
                />
              </th>
            )}
            {columns.map((column) => {
              const isSorted = sort?.key === column.key
              return (
                <th
                  key={column.key}
                  aria-sort={
                    isSorted ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                  className={cn('px-3 py-2 font-medium', column.className)}
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200"
                    >
                      {column.header}
                      <span aria-hidden="true" className="text-[0.65rem]">
                        {isSorted ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => {
            const key = rowKey(row)
            const isSelected = selected.includes(key)
            return (
              <tr
                key={key}
                className={cn(
                  'border-b border-slate-100 last:border-0 dark:border-slate-800',
                  selectable && isSelected && 'bg-brand-50 dark:bg-brand-950/40',
                )}
              >
                {selectable && (
                  <td className="px-3 py-2 align-top">
                    <input
                      type="checkbox"
                      aria-label="Seleccionar fila"
                      checked={isSelected}
                      onChange={() => toggleRow(key)}
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-600"
                    />
                  </td>
                )}
                {columns.map((column) => (
                  <td key={column.key} className={cn('px-3 py-2 align-top', column.className)}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Extrae texto plano de un nodo React para poder ordenar aunque la columna no
 * declare `sortValue`. Es una red de seguridad: lo ideal es declarar
 * `sortValue` en la columna (mas barato y mas preciso).
 */
function extractText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join(' ')
  if (typeof node === 'object' && 'props' in node) {
    const props = (node as { props?: { children?: ReactNode } }).props
    return extractText(props?.children)
  }
  return ''
}

export function Pagination({
  page,
  totalPages,
  total,
  onPage,
  pageSize,
  pageSizeOptions,
  onPageSize,
}: {
  page: number
  totalPages: number
  total?: number
  onPage: (page: number) => void
  pageSize?: number
  pageSizeOptions?: number[]
  onPageSize?: (size: number) => void
}) {
  // Con una sola página y sin control de tamaño no hay nada que mostrar.
  if (totalPages <= 1 && !onPageSize) return null

  // Ventana de páginas alrededor de la actual, con "…" en los extremos.
  const windowSize = 5
  let start = Math.max(1, page - Math.floor(windowSize / 2))
  const end = Math.min(totalPages, start + windowSize - 1)
  start = Math.max(1, end - windowSize + 1)
  const pages: number[] = []
  for (let value = start; value <= end; value += 1) pages.push(value)

  return (
    <nav
      aria-label="Paginación"
      className="flex flex-wrap items-center justify-between gap-3 pt-3 text-sm text-slate-600 dark:text-slate-300"
    >
      <span>
        Página {page} de {totalPages}
        {typeof total === 'number' && (
          <span className="text-slate-400 dark:text-slate-500"> · {total} en total</span>
        )}
      </span>

      <div className="flex flex-wrap items-center gap-3">
        {onPageSize && pageSizeOptions && pageSize && (
          <label className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            Por página
            <select
              value={pageSize}
              onChange={(event) => onPageSize(Number(event.target.value))}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        )}

        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPage(page - 1)}
            >
              Anterior
            </Button>
            {pages.map((value) => (
              <Button
                key={value}
                variant={value === page ? 'primary' : 'secondary'}
                size="sm"
                aria-current={value === page ? 'page' : undefined}
                onClick={() => onPage(value)}
              >
                {value}
              </Button>
            ))}
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => onPage(page + 1)}
            >
              Siguiente
            </Button>
          </div>
        )}
      </div>
    </nav>
  )
}
