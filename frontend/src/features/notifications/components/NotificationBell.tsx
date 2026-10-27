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
import styles from './NotificationBell.module.css'

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
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

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

  // Cierra con Escape o al pulsar fuera, y devuelve el foco al panel/trigger
  // cuando se cierra con Escape (patron de popover accesible).
  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

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
    <div ref={containerRef} className={styles.container}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => void toggle()}
        aria-label={`Notificaciones${count > 0 ? `, ${count} sin leer` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? 'notifications-panel' : undefined}
        className={styles.trigger}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.icon}>
          <path
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h11m0 0a3 3 0 1 1-6 0"
          />
        </svg>
        {count > 0 && <span className={styles.badge}>{count > 9 ? '9+' : count}</span>}
      </button>

      {open && (
        <div
          ref={panelRef}
          id="notifications-panel"
          role="dialog"
          aria-label={t('notifications.title')}
          className={styles.panel}
        >
          <div className={styles.panelHeader}>
            <span className={styles.panelTitle}>{t('notifications.title')}</span>
            <button
              type="button"
              className={styles.markAllButton}
              onClick={() => void readAll()}
              disabled={count === 0}
            >
              {t('notifications.markAll')}
            </button>
          </div>
          <div className={styles.listScroll}>
            {loading ? (
              <div className={styles.loadingContainer}>
                <Spinner />
              </div>
            ) : items.length === 0 ? (
              <p className={styles.emptyText}>{t('notifications.empty')}</p>
            ) : (
              <ul className={styles.list}>
                {items.map((notification) => (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => void openOne(notification)}
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
            )}
          </div>
          <div className={styles.panelFooter}>
            <button
              type="button"
              className={styles.viewAllButton}
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
