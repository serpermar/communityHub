import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Pagination,
  Select,
} from '@/components/ui'
import { useToast } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useResource } from '@/hooks/useResource'
import { t } from '@/i18n'
import { formatDateTime } from '@/utils/format'
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../api'
import { notificationLink } from '../links'
import type { Notification } from '../types'

/**
 * Bandeja completa de notificaciones (el punto 5 del listado de mejoras).
 *
 * La campana de la cabecera solo mostraba las 10 ultimas en un desplegable; aqui
 * hay paginacion, filtro por leidas y el mismo enrutado por `payload`.
 */
export function NotificationsPage() {
  const navigate = useNavigate()
  const { notify } = useToast()
  const [page, setPage] = useState(1)
  const [unread, setUnread] = useState(false)
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
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">
          {t('notifications.pageTitle')}
        </h1>
        <Button variant="secondary" onClick={() => void readAll()}>
          {t('notifications.markAll')}
        </Button>
      </div>

      <Card>
        <Select
          aria-label="Filtro"
          value={unread ? 'unread' : 'all'}
          onChange={(event) => {
            setUnread(event.target.value === 'unread')
            setPage(1)
          }}
          className="sm:w-64"
        >
          <option value="all">{t('notifications.all')}</option>
          <option value="unread">{t('notifications.onlyUnread')}</option>
        </Select>
      </Card>

      {error && <ErrorState error={error} />}

      {result.loading ? (
        <LoadingState />
      ) : result.error ? (
        <ErrorState error={result.error} onRetry={result.reload} />
      ) : result.data ? (
        result.data.data.length === 0 ? (
          <EmptyState title={t('notifications.empty')} />
        ) : (
          <>
            <Card>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {result.data.data.map((notification) => (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => void open(notification)}
                      className="flex w-full flex-col gap-0.5 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <span className="flex items-center gap-2">
                        {!notification.readAt && (
                          <span
                            className="h-2 w-2 rounded-full bg-brand-600"
                            aria-label={t('notifications.unread')}
                          />
                        )}
                        <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                          {notification.title}
                        </span>
                      </span>
                      <span className="text-sm text-slate-500 dark:text-slate-400">
                        {notification.body}
                      </span>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">
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
