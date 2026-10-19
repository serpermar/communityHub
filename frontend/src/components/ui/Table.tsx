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
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            {columns.map((column) => (
              <th key={column.key} className={cn('px-3 py-2 font-medium', column.className)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-slate-100 last:border-0">
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
}: {
  page: number
  totalPages: number
  total?: number
  onPage: (page: number) => void
}) {
  if (totalPages <= 1) return null
  return (
    <nav
      aria-label="Paginación"
      className="flex items-center justify-between gap-3 pt-3 text-sm text-slate-600"
    >
      <span>
        Página {page} de {totalPages}
        {typeof total === 'number' && <span className="text-slate-400"> · {total} en total</span>}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Anterior
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Siguiente
        </Button>
      </div>
    </nav>
  )
}
