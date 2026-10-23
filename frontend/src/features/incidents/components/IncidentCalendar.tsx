import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, INCIDENT_PRIORITY_TONES, INCIDENT_STATUS_TONES } from '@/components/ui'
import { useCommunity } from '@/context/CommunityContext'
import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type Incident,
} from '../types'
import { formatDate } from '@/utils/format'

function getStartOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function getEndOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
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
        <h3 className="text-lg font-semibold capitalize text-slate-800 dark:text-slate-100">{monthLabel}</h3>
        <p className="text-sm text-slate-500">{incidents.length} incidencias en este periodo</p>
      </div>

      <div className="overflow-x-auto rounded-card border border-slate-200 bg-surface dark:border-slate-800">
        <div className="grid min-w-[900px] grid-cols-7">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="border-b border-slate-200 px-2 py-2 text-center text-xs font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400"
            >
              {day}
            </div>
          ))}
          {days.map((day, index) => {
            if (!day) {
              return <div key={`empty-${index}`} className="min-h-[140px] border-b border-r border-slate-100 bg-slate-50/40 dark:border-slate-800/60 dark:bg-slate-900/20" />
            }
            const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`
            const dayIncidents = incidentsByDay.get(key) ?? []
            const isToday = isSameDay(day, today)

            return (
              <div
                key={key}
                className="min-h-[140px] border-b border-r border-slate-200 p-2 dark:border-slate-800"
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-sm ${
                      isToday
                        ? 'bg-brand-600 text-white'
                        : 'text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {day.getDate()}
                  </span>
                  {dayIncidents.length > 0 && (
                    <span className="text-xs text-slate-400">{dayIncidents.length}</span>
                  )}
                </div>
                <div className="mt-1 space-y-1">
                  {dayIncidents.slice(0, 4).map((incident) => (
                    <button
                      key={incident.id}
                      onClick={() => navigate(`/c/${active!.id}/incidents/${incident.id}`)}
                      className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-left transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate text-xs font-medium text-brand-700 dark:text-brand-400">
                          {incident.title}
                        </span>
                        <span className="font-mono text-[10px] text-slate-400">{incident.referenceCode}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1">
                        <Badge tone={INCIDENT_STATUS_TONES[incident.status]}>{STATUS_LABELS[incident.status]}</Badge>
                        <Badge tone={INCIDENT_PRIORITY_TONES[incident.priority]}>{PRIORITY_LABELS[incident.priority]}</Badge>
                        <span className="text-[10px] text-slate-400">{CATEGORY_LABELS[incident.category]}</span>
                      </div>
                      <p className="mt-0.5 text-[10px] text-slate-400">{formatDate(incident.createdAt)}</p>
                    </button>
                  ))}
                  {dayIncidents.length > 4 && (
                    <p className="px-1 text-xs text-slate-400">+{dayIncidents.length - 4} más</p>
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
