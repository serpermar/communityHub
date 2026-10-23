import type { ReactNode } from 'react'
import type { ApiError } from '@/services/ApiError'
import { cn } from '@/utils/cn'
import { Button } from './Button'
import { EmptyAlertIcon } from './EmptyIllustrations'

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Cargando"
      className={cn(
        'inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600 dark:border-slate-600 dark:border-t-brand-400',
        className,
      )}
    />
  )
}

export function LoadingState({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-slate-500 dark:text-slate-400">
      <Spinner />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-slate-200 dark:bg-slate-800', className)}
    />
  )
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Cargando" className="space-y-3" data-testid="skeleton-list">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
        >
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}

/**
 * Esqueleto con la forma de una tabla real (cabecera + filas de celdas), para
 * que la carga de un listado no salte de un bloque generico a una tabla con
 * columnas. El numero de columnas se ajusta con `columns`.
 */
export function SkeletonTable({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div
      role="status"
      aria-label="Cargando"
      className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
      data-testid="skeleton-table"
    >
      <div className="flex items-center gap-4 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        {Array.from({ length: columns }).map((_, index) => (
          <Skeleton key={index} className={cn('h-3', index === 0 ? 'w-1/4' : 'w-16')} />
        ))}
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="flex items-center gap-4 px-4 py-3">
            {Array.from({ length: columns }).map((_, index) => (
              <Skeleton key={index} className={cn('h-4', index === 0 ? 'w-1/4' : 'w-16')} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Esqueleto con la forma de una pantalla de detalle (cabecera + dos bloques),
 * para no saltar de un spinner centrado a un layout completamente distinto.
 */
export function SkeletonDetail() {
  return (
    <div role="status" aria-label="Cargando" className="space-y-4" data-testid="skeleton-detail">
      <div>
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="mt-3 h-3 w-1/4" />
      </div>
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-5/6" />
      </div>
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  )
}

/**
 * Esqueleto para el dashboard: una fila de tarjetas de KPI y dos bloques de
 * gráfico.
 */
export function SkeletonDashboard() {
  return (
    <div role="status" aria-label="Cargando" className="space-y-4" data-testid="skeleton-dashboard">
      <Skeleton className="h-7 w-64" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="mt-3 h-6 w-1/3" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div
            key={index}
            className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="mt-4 h-48 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="rounded-card border border-dashed border-slate-300 bg-surface px-6 py-12 text-center dark:border-slate-700 dark:bg-slate-900">
      {icon && (
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 motion-safe:animate-fade-in dark:bg-slate-800 dark:text-slate-500">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</p>
      {description && (
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

/**
 * Estado de error con ilustración sutil, para unificar el tono con los
 * estados vacíos sin perder la información del `ApiError`.
 */
export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div className="rounded-card border border-danger-200 bg-danger-50 px-6 py-8 text-center dark:border-danger-900 dark:bg-danger-950/40">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-danger-100 text-danger-500 dark:bg-danger-900/60 dark:text-danger-300">
        <EmptyAlertIcon className="h-6 w-6" />
      </div>
      <p className="text-sm font-medium text-danger-800 dark:text-danger-300">{error.message}</p>
      <p className="mt-1 text-meta text-danger-600 dark:text-danger-400">Código: {error.code}</p>
      {onRetry && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Reintentar
          </Button>
        </div>
      )}
    </div>
  )
}

type AlertVariant = 'info' | 'success' | 'warning' | 'error'

const ALERT_STYLES: Record<AlertVariant, string> = {
  info: 'border-info-200 bg-info-50 text-info-800 dark:border-info-900 dark:bg-info-950/40 dark:text-info-300',
  success:
    'border-success-200 bg-success-50 text-success-800 dark:border-success-900 dark:bg-success-950/40 dark:text-success-300',
  warning:
    'border-warning-200 bg-warning-50 text-warning-800 dark:border-warning-900 dark:bg-warning-950/40 dark:text-warning-300',
  error:
    'border-danger-200 bg-danger-50 text-danger-800 dark:border-danger-900 dark:bg-danger-950/40 dark:text-danger-300',
}

export function Alert({
  variant = 'info',
  children,
  className,
}: {
  variant?: AlertVariant
  children: ReactNode
  className?: string
}) {
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn('rounded-md border px-4 py-3 text-sm', ALERT_STYLES[variant], className)}
    >
      {children}
    </div>
  )
}
