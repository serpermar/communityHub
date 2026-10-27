import { useEffect, useMemo, useState } from 'react'
import { Badge, Card, ErrorState, LoadingState, RESERVATION_STATUS_TONES } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useCommunity } from '@/context/CommunityContext'
import { listReservations } from '../api'
import { RESERVATION_STATUS_LABELS, type Reservation } from '../types'
import styles from './ReservationCalendar.module.css'

/**
 * Calendario semanal de reservas (punto 7 del listado de mejoras).
 *
 * La API solo filtra por UNA fecha (`app_list_community_reservations` recibe
 * `p_date`, no un rango), asi que no se puede pedir un mes de golpe sin tocar
 * SQL. En su lugar se cargan los 7 dias de la semana visible en paralelo y se
 * pinta una rejilla dia a dia.
 */

const DAY_MS = 24 * 60 * 60 * 1000

function startOfWeek(date: Date): Date {
  const base = new Date(date)
  base.setHours(0, 0, 0, 0)
  // Lunes como primer dia (locale es-ES).
  const day = (base.getDay() + 6) % 7
  return new Date(base.getTime() - day * DAY_MS)
}

function isoDate(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

const WEEKDAY_FORMAT = new Intl.DateTimeFormat('es-ES', { weekday: 'short' })
const HOUR_FORMAT = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' })

export function ReservationCalendar() {
  const { active } = useCommunity()
  const [weekOffset, setWeekOffset] = useState(0)
  const [byDay, setByDay] = useState<Record<string, Reservation[]> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const days = useMemo(() => {
    const start = startOfWeek(new Date())
    start.setDate(start.getDate() + weekOffset * 7)
    return Array.from({ length: 7 }, (_, index) => new Date(start.getTime() + index * DAY_MS))
  }, [weekOffset])

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

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.navButton}
          onClick={() => setWeekOffset((value) => value - 1)}
        >
          ← Semana anterior
        </button>
        <span className={styles.rangeLabel}>
          {days[0].toLocaleDateString('es-ES')} – {days[6].toLocaleDateString('es-ES')}
        </span>
        <button
          type="button"
          className={styles.navButton}
          onClick={() => setWeekOffset((value) => value + 1)}
        >
          Semana siguiente →
        </button>
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} />
      ) : (
        <div className={styles.weekGrid}>
          {days.map((day) => {
            const key = isoDate(day)
            const rows = byDay?.[key] ?? []
            const isToday = key === isoDate(new Date())
            return (
              <Card
                key={key}
                className={isToday ? styles.todayCard : undefined}
                title={
                  <span className={styles.cardTitle}>
                    <span className={styles.weekdayLabel}>{WEEKDAY_FORMAT.format(day)}</span>
                    <span className={styles.dayNumber}>{day.getDate()}</span>
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
                            {HOUR_FORMAT.format(new Date(reservation.startsAt))}–
                            {HOUR_FORMAT.format(new Date(reservation.endsAt))}
                          </span>
                          <Badge tone={RESERVATION_STATUS_TONES[reservation.status]}>
                            {RESERVATION_STATUS_LABELS[reservation.status]}
                          </Badge>
                        </div>
                        <p className={styles.areaName}>{reservation.commonAreaName}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
