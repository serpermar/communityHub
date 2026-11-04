import { useEffect, useMemo, useState } from 'react'
import { Badge, Card, ErrorState, LoadingState, RESERVATION_STATUS_TONES } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useCommunity } from '@/context/CommunityContext'
import { listReservations } from '../api'
import { RESERVATION_STATUS_LABELS, type Reservation } from '../types'
import styles from './ReservationCalendar.module.css'

/**
 * Calendario semanal/mensual de reservas
 */

const DAY_MS = 24 * 60 * 60 * 1000

function startOfWeek(date: Date): Date {
  const base = new Date(date)
  base.setHours(0, 0, 0, 0)
  // Lunes como primer dia (locale es-ES).
  const day = (base.getDay() + 6) % 7
  return new Date(base.getTime() - day * DAY_MS)
}

function startOfMonth(date: Date): Date {
  const base = new Date(date.getFullYear(), date.getMonth(), 1)
  base.setHours(0, 0, 0, 0)
  return base
}

function isoDate(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

const WEEKDAY_FORMAT = new Intl.DateTimeFormat('es-ES', { weekday: 'short' })
const MONTH_FORMAT = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' })
const HOUR_FORMAT = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' })

type ViewMode = 'week' | 'month'

export function ReservationCalendar() {
  const { active } = useCommunity()
  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [weekOffset, setWeekOffset] = useState(0)
  const [monthOffset, setMonthOffset] = useState(0)
  const [byDay, setByDay] = useState<Record<string, Reservation[]> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const days = useMemo(() => {
    if (viewMode === 'week') {
      const start = startOfWeek(new Date())
      start.setDate(start.getDate() + weekOffset * 7)
      return Array.from({ length: 7 }, (_, index) => new Date(start.getTime() + index * DAY_MS))
    } else {
      const start = startOfMonth(new Date())
      start.setMonth(start.getMonth() + monthOffset)
      // Empezar desde el lunes de la semana que contiene el primer día
      const firstDay = startOfWeek(start)
      const totalDays = 42 // 6 semanas
      return Array.from(
        { length: totalDays },
        (_, index) => new Date(firstDay.getTime() + index * DAY_MS),
      )
    }
  }, [viewMode, weekOffset, monthOffset])

  const currentDate = useMemo(() => {
    if (viewMode === 'week') {
      const start = startOfWeek(new Date())
      start.setDate(start.getDate() + weekOffset * 7)
      return start
    } else {
      const start = startOfMonth(new Date())
      start.setMonth(start.getMonth() + monthOffset)
      return start
    }
  }, [viewMode, weekOffset, monthOffset])

  useEffect(() => {
    let cancelled = false
    if (!active) return
    setLoading(true)
    setError(null)
    Promise.all(
      days.map((day) =>
        listReservations(active.id, { date: isoDate(day), limit: 100 }).then((result) => ({
          key: isoDate(day),
          rows: result.data,
        })),
      ),
    )
      .then((results) => {
        if (cancelled) return
        const grouped: Record<string, Reservation[]> = {}
        for (const { key, rows } of results) {
          grouped[key] = rows.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
        }
        setByDay(grouped)
      })
      .catch((caught) => {
        if (!cancelled) setError(ApiError.from(caught))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [active, days])

  const goToToday = () => {
    setWeekOffset(0)
    setMonthOffset(0)
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.viewToggle}>
            <button
              type="button"
              className={`${styles.viewToggleBtn} ${viewMode === 'week' ? styles.viewToggleBtnActive : ''}`}
              onClick={() => setViewMode('week')}
            >
              Semana
            </button>
            <button
              type="button"
              className={`${styles.viewToggleBtn} ${viewMode === 'month' ? styles.viewToggleBtnActive : ''}`}
              onClick={() => setViewMode('month')}
            >
              Mes
            </button>
          </div>
          <button type="button" className={styles.todayBtn} onClick={goToToday}>
            Hoy
          </button>
        </div>
        <div className={styles.headerCenter}>
          {viewMode === 'week' ? (
            <span className={styles.rangeLabel}>
              {days[0].toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })} –{' '}
              {days[6].toLocaleDateString('es-ES', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </span>
          ) : (
            <span className={styles.rangeLabel}>{MONTH_FORMAT.format(currentDate)}</span>
          )}
        </div>
        <div className={styles.headerRight}>
          <button
            type="button"
            className={styles.navButton}
            onClick={() =>
              viewMode === 'week' ? setWeekOffset((v) => v - 1) : setMonthOffset((v) => v - 1)
            }
            aria-label={viewMode === 'week' ? 'Semana anterior' : 'Mes anterior'}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M10 12L6 8L10 4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            className={styles.navButton}
            onClick={() =>
              viewMode === 'week' ? setWeekOffset((v) => v + 1) : setMonthOffset((v) => v + 1)
            }
            aria-label={viewMode === 'week' ? 'Semana siguiente' : 'Mes siguiente'}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M6 4L10 8L6 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} />
      ) : (
        <div className={viewMode === 'week' ? styles.weekGrid : styles.monthGrid}>
          {viewMode === 'month' && (
            <div className={styles.monthHeader}>
              {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((day) => (
                <div key={day} className={styles.monthHeaderCell}>
                  {day}
                </div>
              ))}
            </div>
          )}
          {days.map((day) => {
            const key = isoDate(day)
            const rows = byDay?.[key] ?? []
            const isToday = key === isoDate(new Date())
            const isCurrentMonth = viewMode === 'month' && day.getMonth() === currentDate.getMonth()

            if (viewMode === 'week') {
              return (
                <Card
                  key={key}
                  className={isToday ? styles.todayCard : undefined}
                  title={
                    <span className={styles.cardTitle}>
                      <span className={styles.weekdayLabel}>{WEEKDAY_FORMAT.format(day)}</span>
                      <span
                        className={`${styles.dayNumber} ${isToday ? styles.dayNumberToday : ''}`}
                      >
                        {day.getDate()}
                      </span>
                    </span>
                  }
                >
                  {rows.length === 0 ? (
                    <p className={styles.emptyText}>Sin reservas</p>
                  ) : (
                    <ul className={styles.list}>
                      {rows.map((reservation) => (
                        <li key={reservation.id} className={styles.item}>
                          <div className={styles.itemHeader}>
                            <span className={styles.timeRange}>
                              {HOUR_FORMAT.format(new Date(reservation.startsAt))} -{' '}
                              {HOUR_FORMAT.format(new Date(reservation.endsAt))}
                            </span>
                            <Badge tone={RESERVATION_STATUS_TONES[reservation.status]}>
                              {RESERVATION_STATUS_LABELS[reservation.status]}
                            </Badge>
                          </div>
                          <p className={styles.areaName} title={reservation.commonAreaName}>
                            {reservation.commonAreaName}
                          </p>
                          {reservation.userName && (
                            <p className={styles.userName} title={reservation.userName}>
                              {reservation.userName}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )
            } else {
              return (
                <div
                  key={key}
                  className={`${styles.monthCell} ${isToday ? styles.monthCellToday : ''} ${
                    !isCurrentMonth ? styles.monthCellOtherMonth : ''
                  }`}
                >
                  <div className={styles.monthCellHeader}>
                    <span
                      className={`${styles.monthDayNumber} ${isToday ? styles.monthDayNumberToday : ''}`}
                    >
                      {day.getDate()}
                    </span>
                  </div>
                  <div className={styles.monthCellContent}>
                    {rows.slice(0, 3).map((reservation) => (
                      <div
                        key={reservation.id}
                        className={styles.monthReservationItem}
                        style={{
                          borderLeftColor:
                            reservation.status === 'CONFIRMED'
                              ? '#10b981'
                              : reservation.status === 'PENDING'
                                ? '#f59e0b'
                                : '#ef4444',
                        }}
                        title={`${reservation.commonAreaName} - ${HOUR_FORMAT.format(new Date(reservation.startsAt))}`}
                      >
                        <span className={styles.monthReservationTime}>
                          {HOUR_FORMAT.format(new Date(reservation.startsAt))}
                        </span>
                        <span className={styles.monthReservationArea}>
                          {reservation.commonAreaName}
                        </span>
                      </div>
                    ))}
                    {rows.length > 3 && (
                      <div className={styles.monthMoreCount}>+{rows.length - 3} más</div>
                    )}
                  </div>
                </div>
              )
            }
          })}
        </div>
      )}
    </div>
  )
}
