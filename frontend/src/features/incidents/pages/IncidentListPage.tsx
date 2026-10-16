import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, Card, DataTable, Pagination, Select, Input, type Column } from '@/components/ui'
import { LoadingState, ErrorState, EmptyState } from '@/components/ui'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { formatDate } from '@/utils/format'
import { listIncidents } from '../api'
import {
  CATEGORY_LABELS,
  INCIDENT_CATEGORIES,
  INCIDENT_PRIORITIES,
  INCIDENT_STATUSES,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type Incident,
  type IncidentCategory,
  type IncidentPriority,
  type IncidentStatus,
} from '../types'

const STATUS_TONES: Record<IncidentStatus, 'blue' | 'amber' | 'green' | 'slate'> = {
  OPEN: 'blue',
  IN_PROGRESS: 'amber',
  RESOLVED: 'green',
  CANCELLED: 'slate',
}

const PRIORITY_TONES: Record<IncidentPriority, 'slate' | 'blue' | 'amber' | 'red'> = {
  LOW: 'slate',
  MEDIUM: 'blue',
  HIGH: 'amber',
  CRITICAL: 'red',
}

export function IncidentListPage() {
  const { active, role } = useCommunity()
  const navigate = useNavigate()
  const [status, setStatus] = useState<IncidentStatus | ''>('')
  const [priority, setPriority] = useState<IncidentPriority | ''>('')
  const [category, setCategory] = useState<IncidentCategory | ''>('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const debouncedQ = useDebouncedValue(q)

  const result = useResource(
    () =>
      listIncidents(active!.id, {
        status: status || undefined,
        priority: priority || undefined,
        category: category || undefined,
        q: debouncedQ || undefined,
        page,
        limit: 20,
      }),
    [active?.id, status, priority, category, debouncedQ, page],
  )

  const columns: Column<Incident>[] = [
    {
      key: 'reference',
      header: 'Referencia',
      render: (incident) => (
        <span className="font-mono text-xs text-slate-500">{incident.referenceCode}</span>
      ),
    },
    {
      key: 'title',
      header: 'Título',
      render: (incident) => (
        <button
          type="button"
          className="text-left font-medium text-brand-700 hover:underline"
          onClick={() => navigate(`/c/${active!.id}/incidents/${incident.id}`)}
        >
          {incident.title}
        </button>
      ),
    },
    { key: 'category', header: 'Categoría', render: (row) => CATEGORY_LABELS[row.category] },
    {
      key: 'priority',
      header: 'Prioridad',
      render: (row) => <Badge tone={PRIORITY_TONES[row.priority]}>{PRIORITY_LABELS[row.priority]}</Badge>,
    },
    {
      key: 'status',
      header: 'Estado',
      render: (row) => <Badge tone={STATUS_TONES[row.status]}>{STATUS_LABELS[row.status]}</Badge>,
    },
    { key: 'createdAt', header: 'Creada', render: (row) => formatDate(row.createdAt) },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Incidencias</h1>
        {role !== 'PROVIDER' && (
          <Button onClick={() => navigate(`/c/${active!.id}/incidents/new`)}>Nueva incidencia</Button>
        )}
      </div>

      <Card>
        <div className="grid gap-3 sm:grid-cols-4">
          <Select
            aria-label="Estado"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as IncidentStatus | '')
              setPage(1)
            }}
          >
            <option value="">Todos los estados</option>
            {INCIDENT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Prioridad"
            value={priority}
            onChange={(event) => {
              setPriority(event.target.value as IncidentPriority | '')
              setPage(1)
            }}
          >
            <option value="">Todas las prioridades</option>
            {INCIDENT_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {PRIORITY_LABELS[value]}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Categoría"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value as IncidentCategory | '')
              setPage(1)
            }}
          >
            <option value="">Todas las categorías</option>
            {INCIDENT_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {CATEGORY_LABELS[value]}
              </option>
            ))}
          </Select>
          <Input
            aria-label="Buscar"
            placeholder="Buscar por título…"
            value={q}
            onChange={(event) => {
              setQ(event.target.value)
              setPage(1)
            }}
          />
        </div>
      </Card>

      {result.loading ? (
        <LoadingState />
      ) : result.error ? (
        <ErrorState error={result.error} onRetry={result.reload} />
      ) : result.data ? (
        <>
          <Card>
            <DataTable
              columns={columns}
              rows={result.data.data}
              rowKey={(row) => row.id}
              empty={
                <EmptyState
                  title="No hay incidencias"
                  description="No se encontraron incidencias con estos filtros."
                />
              }
            />
          </Card>
          <Pagination
            page={result.data.meta.page}
            totalPages={result.data.meta.totalPages}
            total={result.data.meta.total}
            onPage={setPage}
          />
        </>
      ) : null}
    </div>
  )
}
