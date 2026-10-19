import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Spinner } from '@/components/ui'
import { t } from '@/i18n'
import { formatDateTime } from '@/utils/format'
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../api'
import { notificationLink } from '../links'
import type { Notification } from '../types'

const POLL_MS = 60000

/**
 * Campana con sondeo cada 60 s y revalidacion al recuperar el foco (FE-12).
 */
export function NotificationBell() {
  const navigate = useNavigate()
  const [count, setCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)
  const mounted = useRef(true)

  const refreshCount = useCallback(async () => {
    try {
      const result = await getUnreadCount()
      if (mounted.current) setCount(result.count)
    } catch {
      // La campana no debe romper la app si el sondeo falla.
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void refreshCount()
    const interval = window.setInterval(() => void refreshCount(), POLL_MS)
    const onFocus = () => void refreshCount()
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    return () => {
      mounted.current = false
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('focus', onFocus)
    }
  }, [refreshCount])

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next) {
      setLoading(true)
      try {
        const result = await listNotifications({ limit: 10 })
        setItems(result.data)
      } finally {
        setLoading(false)
      }
    }
  }

  const openOne = async (notification: Notification) => {
    if (!notification.readAt) {
      try {
        await markNotificationRead(notification.id)
        setItems((current) =>
          current.map((item) =>
            item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item,
          ),
        )
        setCount((current) => Math.max(0, current - 1))
      } catch {
        // Ignorar: la notificacion sigue ahi.
      }
    }
    const link = notificationLink(notification)
    if (link) {
      setOpen(false)
      navigate(link)
    }
  }

  const readAll = async () => {
    try {
      await markAllNotificationsRead()
      setItems((current) =>
        current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })),
      )
      setCount(0)
    } catch {
      // Ignorar.
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-label={`Notificaciones${count > 0 ? `, ${count} sin leer` : ''}`}
        className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current">
          <path
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h11m0 0a3 3 0 1 1-6 0"
          />
        </svg>
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-slate-800">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {t('notifications.title')}
            </span>
            <button
              type="button"
              className="text-xs text-brand-700 hover:underline disabled:text-slate-400 dark:text-brand-400"
              onClick={() => void readAll()}
              disabled={count === 0}
            >
              {t('notifications.markAll')}
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                {t('notifications.empty')}
              </p>
            ) : (
              <ul>
                {items.map((notification) => (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => void openOne(notification)}
                      className="flex w-full flex-col gap-0.5 border-b border-slate-100 px-4 py-3 text-left last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
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
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {notification.body}
                      </span>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">
                        {formatDateTime(notification.createdAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-slate-100 px-3 py-2 text-center dark:border-slate-800">
            <button
              type="button"
              className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-400"
              onClick={() => {
                setOpen(false)
                navigate('/notifications')
              }}
            >
              {t('notifications.viewAll')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
