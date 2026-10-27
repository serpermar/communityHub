import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, INCIDENT_PRIORITY_TONES, INCIDENT_STATUS_TONES } from '@/components/ui'
import { useCommunity } from '@/context/CommunityContext'
import { CATEGORY_LABELS, PRIORITY_LABELS, STATUS_LABELS, type Incident } from '../types'
import { formatDate } from '@/utils/format'
import styles from './IncidentCalendar.module.css'

function getStartOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function getEndOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

export function IncidentCalendar({ incidents }: { incidents: Incident[] }) {
  const { active } = useCommunity()
  const navigate = useNavigate()
  const [currentDate, setCurrentDate] = useState(() => new Date())

  const monthStart = useMemo(() => getStartOfMonth(currentDate), [currentDate])
  const monthEnd = useMemo(() => getEndOfMonth(currentDate), [currentDate])

  const incidentsByDay = useMemo(() => {
    const map = new Map<string, Incident[]>()
    for (const incident of incidents) {
      const date = new Date(incident.createdAt)
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(incident)
    }
    return map
  }, [incidents])

  const days = useMemo(() => {
    const result: (Date | null)[] = []
    const firstDayOfWeek = (monthStart.getDay() + 6) % 7
    for (let i = 0; i < firstDayOfWeek; i++) {
      result.push(null)
    }
    for (let day = 1; day <= monthEnd.getDate(); day++) {
      result.push(new Date(monthStart.getFullYear(), monthStart.getMonth(), day))
    }
    return result
  }, [monthStart, monthEnd])

  const goToPrevMonth = () => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
  }

  const goToNextMonth = () => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
  }

  const goToToday = () => {
    setCurrentDate(new Date())
  }

  const monthLabel = currentDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })

  const today = new Date()

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.navGroup}>
          <Button size="sm" variant="secondary" onClick={goToPrevMonth}>
            ← Anterior
          </Button>
          <Button size="sm" variant="secondary" onClick={goToToday}>
            Hoy
          </Button>
          <Button size="sm" variant="secondary" onClick={goToNextMonth}>
            Siguiente →
          </Button>
        </div>
        <h3 className={styles.monthTitle}>{monthLabel}</h3>
        <p className={styles.periodCount}>{incidents.length} incidencias en este periodo</p>
      </div>

      <div className={styles.calendarScroll}>
        <div className={styles.calendarGrid}>
          {WEEKDAYS.map((day) => (
            <div key={day} className={styles.weekdayCell}>
              {day}
            </div>
          ))}
          {days.map((day, index) => {
            if (!day) {
              return <div key={`empty-${index}`} className={styles.emptyCell} />
            }
            const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`
            const dayIncidents = incidentsByDay.get(key) ?? []
            const isToday = isSameDay(day, today)

            return (
              <div key={key} className={styles.dayCell}>
                <div className={styles.dayHeader}>
                  <span className={`${styles.dayNumber} ${isToday ? styles.dayNumberToday : ''}`}>
                    {day.getDate()}
                  </span>
                  {dayIncidents.length > 0 && (
                    <span className={styles.dayCount}>{dayIncidents.length}</span>
                  )}
                </div>
                <div className={styles.incidentList}>
                  {dayIncidents.slice(0, 4).map((incident) => (
                    <button
                      key={incident.id}
                      onClick={() => navigate(`/c/${active!.id}/incidents/${incident.id}`)}
                      className={styles.incidentButton}
                    >
                      <div className={styles.incidentRow}>
                        <span className={styles.incidentTitle}>{incident.title}</span>
                        <span className={styles.incidentRef}>{incident.referenceCode}</span>
                      </div>
                      <div className={styles.incidentBadges}>
                        <Badge tone={INCIDENT_STATUS_TONES[incident.status]}>
                          {STATUS_LABELS[incident.status]}
                        </Badge>
                        <Badge tone={INCIDENT_PRIORITY_TONES[incident.priority]}>
                          {PRIORITY_LABELS[incident.priority]}
                        </Badge>
                        <span className={styles.incidentCategory}>
                          {CATEGORY_LABELS[incident.category]}
                        </span>
                      </div>
                      <p className={styles.incidentDate}>{formatDate(incident.createdAt)}</p>
                    </button>
                  ))}
                  {dayIncidents.length > 4 && (
                    <p className={styles.moreText}>+{dayIncidents.length - 4} más</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
