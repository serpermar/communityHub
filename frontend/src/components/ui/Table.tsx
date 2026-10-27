import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { Button } from './Button'
import styles from './Table.module.css'

export interface Column<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  className?: string
  sortable?: boolean
  sortValue?: (row: T) => string | number
}

type SortDirection = 'asc' | 'desc'
export interface SortState {
  key: string
  direction: SortDirection
}

const TABLE_DENSITY_KEY = 'communityhub.tableDensity'

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
  sort: sortProp,
  onSortChange,
  dense: denseProp,
  bulkActions: _bulkActions,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  empty?: ReactNode
  selectable?: boolean
  selectedKeys?: string[]
  onSelectionChange?: (keys: string[]) => void
  initialSort?: SortState
  sort?: SortState | null
  onSortChange?: (sort: SortState | null) => void
  dense?: boolean
  bulkActions?: (selected: string[]) => ReactNode
}) {
  const [sortState, setSortState] = useState<SortState | null>(initialSort ?? null)
  const sort = sortProp !== undefined ? sortProp : sortState

  const [denseState, setDenseState] = useState(
    () =>
      typeof window !== 'undefined' && window.localStorage.getItem(TABLE_DENSITY_KEY) === 'compact',
  )
  const dense = denseProp !== undefined ? denseProp : denseState
  useEffect(() => {
    if (denseProp !== undefined) return
    window.localStorage.setItem(TABLE_DENSITY_KEY, denseState ? 'compact' : 'comfortable')
  }, [denseState, denseProp])

  const cellPadding = dense ? styles.bodyCellDense : styles.bodyCell
  const headCellPadding = dense ? styles.headCellDense : styles.headCell

  const sortedRows = useMemo(() => {
    const currentSort = sort
    if (!currentSort) return rows
    const column = columns.find((candidate) => candidate.key === currentSort.key)
    if (!column) return rows
    const valueOf = (row: T): string | number =>
      column.sortValue ? column.sortValue(row) : extractText(column.render(row))
    const factor = currentSort.direction === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => compare(valueOf(a), valueOf(b)) * factor)
  }, [rows, columns, sort])

  const toggleSort = (key: string) => {
    if (sortProp !== undefined) {
      const current = sort
      if (current?.key !== key) {
        onSortChange?.({ key, direction: 'asc' })
        return
      }
      if (current.direction === 'asc') {
        onSortChange?.({ key, direction: 'desc' })
        return
      }
      onSortChange?.(null)
      return
    }
    setSortState((current) => {
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
    <div className={styles.wrapper}>
      <div className={styles.densityBar}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDenseState((current) => !current)}
          aria-pressed={dense}
        >
          {dense ? 'Densidad: compacta' : 'Densidad: cómoda'}
        </Button>
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr className={styles.headRow}>
              {selectable && (
                <th className={styles.checkboxCell}>
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todo"
                    checked={allSelected}
                    onChange={toggleAll}
                    className={styles.checkbox}
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
                    className={cn(headCellPadding, column.className)}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className={styles.sortButton}
                      >
                        {column.header}
                        <span aria-hidden="true" className={styles.sortIcon}>
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
                  className={cn(styles.bodyRow, selectable && isSelected && styles.bodyRowSelected)}
                >
                  {selectable && (
                    <td className={dense ? styles.bodyCellCheckboxDense : styles.bodyCellCheckbox}>
                      <input
                        type="checkbox"
                        aria-label="Seleccionar fila"
                        checked={isSelected}
                        onChange={() => toggleRow(key)}
                        className={styles.checkbox}
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td key={column.key} className={cn(cellPadding, column.className)}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

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
  if (totalPages <= 1 && !onPageSize) return null

  const windowSize = 5
  let start = Math.max(1, page - Math.floor(windowSize / 2))
  const end = Math.min(totalPages, start + windowSize - 1)
  start = Math.max(1, end - windowSize + 1)
  const pages: number[] = []
  for (let value = start; value <= end; value += 1) pages.push(value)

  return (
    <nav aria-label="Paginación" className={styles.pagination}>
      <span>
        Página {page} de {totalPages}
        {typeof total === 'number' && (
          <span className={styles.totalLabel}> · {total} en total</span>
        )}
      </span>

      <div className={styles.paginationControls}>
        {onPageSize && pageSizeOptions && pageSize && (
          <label className={styles.pageSizeLabel}>
            Por página
            <select
              value={pageSize}
              onChange={(event) => onPageSize(Number(event.target.value))}
              className={styles.pageSizeSelect}
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
          <div className={styles.pageButtons}>
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
