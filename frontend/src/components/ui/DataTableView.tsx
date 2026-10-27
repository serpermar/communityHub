import { type ReactNode } from 'react'
import { Card } from './Display'
import { DataTable, Pagination, type Column, type SortState } from './Table'
import { ErrorState, EmptyState, SkeletonTable } from './Feedback'
import type { ApiError } from '@/services/ApiError'
import styles from './DataTableView.module.css'

export interface DataTableViewPagination {
  page: number
  totalPages: number
  total?: number
  onPage: (page: number) => void
  pageSize?: number
  pageSizeOptions?: number[]
  onPageSize?: (size: number) => void
}

interface DataTableViewProps<T> {
  title?: ReactNode
  actions?: ReactNode
  filters?: ReactNode
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  loading?: boolean
  error?: ApiError | null
  onRetry?: () => void
  empty?: ReactNode
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: ReactNode
  emptyIcon?: ReactNode
  pagination?: DataTableViewPagination
  selectable?: boolean
  selectedKeys?: string[]
  onSelectionChange?: (keys: string[]) => void
  initialSort?: SortState
  sort?: SortState | null
  onSortChange?: (sort: SortState | null) => void
  dense?: boolean
  className?: string
}

export function DataTableView<T>({
  title,
  actions,
  filters,
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  empty,
  emptyTitle = 'Sin resultados',
  emptyDescription = 'No hay elementos que mostrar con los filtros actuales.',
  emptyAction,
  emptyIcon,
  pagination,
  selectable,
  selectedKeys,
  onSelectionChange,
  initialSort,
  sort,
  onSortChange,
  dense,
  className,
}: DataTableViewProps<T>) {
  if (loading) {
    return (
      <div className={className}>
        {filters && <Card className={styles.filtersCard}>{filters}</Card>}
        <Card title={title} actions={actions}>
          <SkeletonTable columns={columns.length} />
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className={className}>
        {filters && <Card className={styles.filtersCard}>{filters}</Card>}
        <ErrorState error={error} onRetry={onRetry} />
      </div>
    )
  }

  const emptyState =
    empty ??
    (emptyIcon || emptyTitle || emptyDescription || emptyAction ? (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    ) : undefined)

  return (
    <div className={className}>
      {(title || actions || filters) && (
        <>
          {(title || actions) && (
            <div className={styles.header}>
              {typeof title === 'string' ? <h2 className={styles.title}>{title}</h2> : title}
              {actions}
            </div>
          )}
          {filters && <Card className={styles.filtersCard}>{filters}</Card>}
        </>
      )}
      <Card>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={rowKey}
          empty={emptyState}
          selectable={selectable}
          selectedKeys={selectedKeys}
          onSelectionChange={onSelectionChange}
          initialSort={initialSort}
          sort={sort}
          onSortChange={onSortChange}
          dense={dense}
        />
      </Card>
      {pagination && pagination.totalPages > 1 && (
        <div className={styles.paginationWrapper}>
          <Pagination {...pagination} />
        </div>
      )}
    </div>
  )
}
