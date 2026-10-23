import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, INCIDENT_PRIORITY_TONES, INCIDENT_STATUS_TONES } from '@/components/ui'
import { useCommunity } from '@/context/CommunityContext'
import { transitionIncident } from '../api'
import {
  CATEGORY_LABELS,
  INCIDENT_STATUSES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type Incident,
  type IncidentStatus,
} from '../types'
import { formatDate } from '@/utils/format'

const KANBAN_COLUMNS: IncidentStatus[] = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED']

export function IncidentKanban({
  incidents,
  onChanged,
}: {
  incidents: Incident[]
  onChanged?: () => void
}) {
  const { active, role } = useCommunity()
  const navigate = useNavigate()
  const [updating, setUpdating] = useState<string | null>(null)

  const grouped = KANBAN_COLUMNS.map((status) => ({
    status,
    items: incidents.filter((i) => i.status === status),
  }))

  const canTransition = role !== 'PROVIDER' && role !== 'NEIGHBOR'

  const move = async (incidentId: string, status: IncidentStatus) => {
    if (!canTransition) return
    setUpdating(incidentId)
    try {
      await transitionIncident(incidentId, status)
      onChanged?.()
    } finally {
      setUpdating(null)
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {grouped.map((col) => (
        <section
          key={col.status}
          className="rounded-card border border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/40"
        >
          <header className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-2">
              <Badge tone={INCIDENT_STATUS_TONES[col.status]}>{STATUS_LABELS[col.status]}</Badge>
              <span className="text-xs text-slate-500">{col.items.length}</span>
            </div>
          </header>
          <div className="flex flex-col gap-2 p-2">
            {col.items.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-slate-400">Sin incidencias</p>
            )}
            {col.items.map((incident) => (
              <article
                key={incident.id}
                className="rounded-card border border-slate-200 bg-surface p-3 shadow-sm transition hover:shadow-md dark:border-slate-700 dark:bg-slate-900"
              >
                <button
                  className="text-left text-sm font-medium text-brand-700 hover:underline dark:text-brand-400"
                  onClick={() => navigate(`/c/${active!.id}/incidents/${incident.id}`)}
                >
                  {incident.title}
                </button>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                  <span className="font-mono text-slate-400">{incident.referenceCode}</span>
                  <Badge tone={INCIDENT_PRIORITY_TONES[incident.priority]}>
                    {PRIORITY_LABELS[incident.priority]}
                  </Badge>
                  <span className="text-slate-400">{CATEGORY_LABELS[incident.category]}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{formatDate(incident.createdAt)}</p>
                {canTransition && col.status !== 'CANCELLED' && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {INCIDENT_STATUSES.filter((s) => s !== col.status && s !== 'CANCELLED').map((s) => (
                      <Button
                        key={s}
                        size="sm"
                        variant="ghost"
                        loading={updating === incident.id}
                        onClick={() => move(incident.id, s)}
                      >
                        → {STATUS_LABELS[s]}
                      </Button>
                    ))}
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={updating === incident.id}
                      onClick={() => move(incident.id, 'CANCELLED')}
                    >
                      Cancelar
                    </Button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
