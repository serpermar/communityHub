import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { Button } from './Button'

export interface Column<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  className?: string
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  empty?: ReactNode
}) {
  if (rows.length === 0 && empty) return <>{empty}</>
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {columns.map((column) => (
              <th key={column.key} className={cn('px-3 py-2 font-medium', column.className)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b border-slate-100 last:border-0 dark:border-slate-800"
            >
              {columns.map((column) => (
                <td key={column.key} className={cn('px-3 py-2 align-top', column.className)}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
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
