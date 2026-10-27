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
import styles from './IncidentKanban.module.css'

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
    <div className={styles.board}>
      {grouped.map((col) => (
        <section key={col.status} className={styles.column}>
          <header className={styles.columnHeader}>
            <div className={styles.columnTitle}>
              <Badge tone={INCIDENT_STATUS_TONES[col.status]}>{STATUS_LABELS[col.status]}</Badge>
              <span className={styles.columnCount}>{col.items.length}</span>
            </div>
          </header>
          <div className={styles.columnBody}>
            {col.items.length === 0 && <p className={styles.emptyColumn}>Sin incidencias</p>}
            {col.items.map((incident) => (
              <article key={incident.id} className={styles.card}>
                <button
                  className={styles.cardTitle}
                  onClick={() => navigate(`/c/${active!.id}/incidents/${incident.id}`)}
                >
                  {incident.title}
                </button>
                <div className={styles.cardMeta}>
                  <span className={styles.cardRef}>{incident.referenceCode}</span>
                  <Badge tone={INCIDENT_PRIORITY_TONES[incident.priority]}>
                    {PRIORITY_LABELS[incident.priority]}
                  </Badge>
                  <span className={styles.cardCategory}>{CATEGORY_LABELS[incident.category]}</span>
                </div>
                <p className={styles.cardDate}>{formatDate(incident.createdAt)}</p>
                {canTransition && col.status !== 'CANCELLED' && (
                  <div className={styles.cardActions}>
                    {INCIDENT_STATUSES.filter((s) => s !== col.status && s !== 'CANCELLED').map(
                      (s) => (
                        <Button
                          key={s}
                          size="sm"
                          variant="ghost"
                          loading={updating === incident.id}
                          onClick={() => move(incident.id, s)}
                        >
                          → {STATUS_LABELS[s]}
                        </Button>
                      ),
                    )}
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
