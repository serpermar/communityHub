import type { ReactNode } from 'react'
import type { ApiError } from '@/services/ApiError'
import { cn } from '@/utils/cn'
import { Button } from './Button'

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

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center dark:border-slate-700 dark:bg-slate-900">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{title}</p>
      {description && (
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-6 py-8 text-center dark:border-red-900 dark:bg-red-950/40">
      <p className="text-sm font-medium text-red-800 dark:text-red-300">{error.message}</p>
      <p className="mt-1 text-xs text-red-600 dark:text-red-400">Código: {error.code}</p>
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
  info: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300',
  success:
    'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  warning:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  error:
    'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
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
