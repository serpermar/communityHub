import type { ReactNode } from 'react'
import type { ApiError } from '@/services/ApiError'
import { cn } from '@/utils/cn'
import { Button } from './Button'
import { EmptyAlertIcon } from './EmptyIllustrations'
import styles from './Feedback.module.css'

export function Spinner({ className }: { className?: string }) {
  return <span role="status" aria-label="Cargando" className={cn(styles.spinner, className)} />
}

export function LoadingState({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className={styles.loadingState}>
      <Spinner />
      <span className={styles.loadingLabel}>{label}</span>
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn(styles.skeleton, className)} />
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-label="Cargando"
      className={styles.skeletonList}
      data-testid="skeleton-list"
    >
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className={styles.skeletonCard}>
          <Skeleton className={styles.skeletonLineShort} />
          <Skeleton className={styles.skeletonLineLong} />
          <Skeleton className={styles.skeletonLineMedium} />
        </div>
      ))}
    </div>
  )
}

export function SkeletonTable({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div
      role="status"
      aria-label="Cargando"
      className={styles.skeletonTable}
      data-testid="skeleton-table"
    >
      <div className={styles.skeletonTableHeader}>
        {Array.from({ length: columns }).map((_, index) => (
          <Skeleton
            key={index}
            className={index === 0 ? styles.skeletonCellWide : styles.skeletonCellNarrow}
          />
        ))}
      </div>
      <div className={styles.skeletonTableBody}>
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className={styles.skeletonTableRow}>
            {Array.from({ length: columns }).map((_, index) => (
              <Skeleton
                key={index}
                className={index === 0 ? styles.skeletonCellWideBig : styles.skeletonCellNarrowBig}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function SkeletonDetail() {
  return (
    <div
      role="status"
      aria-label="Cargando"
      className={styles.skeletonDetail}
      data-testid="skeleton-detail"
    >
      <div>
        <Skeleton className={styles.skeletonDetailTitle} />
        <Skeleton className={styles.skeletonDetailSubtitle} />
      </div>
      <div className={styles.skeletonDetailBlock}>
        <Skeleton className={styles.skeletonBlockTitle} />
        <Skeleton className={styles.skeletonBlockLineFull} />
        <Skeleton className={styles.skeletonBlockLineThird} />
        <Skeleton className={styles.skeletonBlockLine5} />
      </div>
      <div className={styles.skeletonDetailBlock}>
        <Skeleton className={styles.skeletonBlockLineQuarter} />
        <Skeleton className={styles.skeletonBlockLineFull} />
        <Skeleton className={styles.skeletonBlockLineHalf} />
      </div>
    </div>
  )
}

export function SkeletonDashboard() {
  return (
    <div
      role="status"
      aria-label="Cargando"
      className={styles.skeletonDashboard}
      data-testid="skeleton-dashboard"
    >
      <Skeleton className={styles.skeletonDashboardTitle} />
      <div className={styles.skeletonDashboardGrid}>
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className={styles.skeletonKpiCard}>
            <Skeleton className={styles.skeletonKpiLabel} />
            <Skeleton className={styles.skeletonKpiValue} />
          </div>
        ))}
      </div>
      <div className={styles.skeletonDashboardCharts}>
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className={styles.skeletonChartCard}>
            <Skeleton className={styles.skeletonChartTitle} />
            <Skeleton className={styles.skeletonChartArea} />
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
    <div className={styles.emptyState}>
      {icon && <div className={styles.emptyIconWrapper}>{icon}</div>}
      <p className={styles.emptyTitle}>{title}</p>
      {description && <p className={styles.emptyDescription}>{description}</p>}
      {action && <div className={styles.emptyAction}>{action}</div>}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div className={styles.errorState}>
      <div className={styles.errorIconWrapper}>
        <EmptyAlertIcon className={styles.errorIcon} />
      </div>
      <p className={styles.errorMessage}>{error.message}</p>
      <p className={styles.errorCode}>Código: {error.code}</p>
      {onRetry && (
        <div className={styles.errorRetry}>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Reintentar
          </Button>
        </div>
      )}
    </div>
  )
}

type AlertVariant = 'info' | 'success' | 'warning' | 'error'

const ALERT_CLASSES: Record<AlertVariant, string> = {
  info: styles.alertInfo,
  success: styles.alertSuccess,
  warning: styles.alertWarning,
  error: styles.alertError,
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
      className={cn(styles.alert, ALERT_CLASSES[variant], className)}
    >
      {children}
    </div>
  )
}
