import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Select,
  SkeletonList,
  EmptyBellIcon,
} from '@/components/ui'
import { useToast } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useResource } from '@/hooks/useResource'
import { useUrlFilters } from '@/hooks/useUrlFilters'
import { t } from '@/i18n'
import { formatDateTime } from '@/utils/format'
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../api'
import { notificationLink } from '../links'
import type { Notification } from '../types'
import styles from './NotificationsPage.module.css'

/**
 * Bandeja completa de notificaciones (el punto 5 del listado de mejoras).
 *
 * La campana de la cabecera solo mostraba las 10 ultimas en un desplegable; aqui
 * hay paginacion, filtro por leidas y el mismo enrutado por `payload`.
 */
export function NotificationsPage() {
  const navigate = useNavigate()
  const { notify } = useToast()
  const { filters, page, setFilter, setPage } = useUrlFilters({
    filter: ['all', 'unread'] as const,
  })
  const unread = filters.filter === 'unread'
  const [error, setError] = useState<ApiError | null>(null)

  const result = useResource(
    () => listNotifications({ unread: unread || undefined, page, limit: 20 }),
    [unread, page],
  )

  const open = async (notification: Notification) => {
    setError(null)
    if (!notification.readAt) {
      try {
        await markNotificationRead(notification.id)
        result.reload()
      } catch (caught) {
        setError(ApiError.from(caught))
      }
    }
    const link = notificationLink(notification)
    if (link) navigate(link)
  }

  const readAll = async () => {
    setError(null)
    try {
      await markAllNotificationsRead()
      notify(t('toast.updated'), 'success')
      result.reload()
    } catch (caught) {
      setError(ApiError.from(caught))
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('notifications.pageTitle')}
        actions={
          <Button variant="secondary" onClick={() => void readAll()}>
            {t('notifications.markAll')}
          </Button>
        }
      />

      <Card>
        <Select
          aria-label="Filtro"
          value={unread ? 'unread' : 'all'}
          onChange={(event) => setFilter('filter', event.target.value)}
          className={styles.filterSelect}
        >
          <option value="all">{t('notifications.all')}</option>
          <option value="unread">{t('notifications.onlyUnread')}</option>
        </Select>
      </Card>

      {error && <ErrorState error={error} />}

      {result.loading ? (
        <SkeletonList />
      ) : result.error ? (
        <ErrorState error={result.error} onRetry={result.reload} />
      ) : result.data ? (
        result.data.data.length === 0 ? (
          <EmptyState
            icon={<EmptyBellIcon className={styles.emptyIcon} />}
            title={t('notifications.empty')}
          />
        ) : (
          <>
            <Card>
              <ul className={styles.list}>
                {result.data.data.map((notification) => (
                  <li key={notification.id} className={styles.itemRow}>
                    <button
                      type="button"
                      onClick={() => void open(notification)}
                      className={styles.itemButton}
                    >
                      <span className={styles.itemHeader}>
                        {!notification.readAt && (
                          <span
                            className={styles.unreadDot}
                            aria-label={t('notifications.unread')}
                          />
                        )}
                        <span className={styles.itemTitle}>{notification.title}</span>
                      </span>
                      <span className={styles.itemBody}>{notification.body}</span>
                      <span className={styles.itemDate}>
                        {formatDateTime(notification.createdAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
            <Pagination
              page={result.data.meta.page}
              totalPages={result.data.meta.totalPages}
              total={result.data.meta.total}
              onPage={setPage}
            />
          </>
        )
      ) : null}
    </div>
  )
}
