import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Badge,
  Button,
  Card,
  DataTable,
  Pagination,
  Select,
  Input,
  PageHeader,
  Tabs,
  INCIDENT_STATUS_TONES,
  INCIDENT_PRIORITY_TONES,
  type Column,
} from '@/components/ui'
import { ErrorState, EmptyState, EmptySearchIcon, SkeletonTable } from '@/components/ui'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useUrlFilters } from '@/hooks/useUrlFilters'
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
import { IncidentKanban } from '../components/IncidentKanban'
import { IncidentCalendar } from '../components/IncidentCalendar'

export function IncidentListPage() {
  const { active, role } = useCommunity()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const viewParam = searchParams.get('view')
  const view = viewParam === 'kanban' ? 'kanban' : viewParam === 'calendar' ? 'calendar' : 'list'

  const { filters, page, setFilter, setPage } = useUrlFilters({
    status: INCIDENT_STATUSES,
    priority: INCIDENT_PRIORITIES,
    category: INCIDENT_CATEGORIES,
    q: undefined,
  })
  const { status, priority, category, q } = filters
  const debouncedQ = useDebouncedValue(q)

  const result = useResource(
    () =>
      listIncidents(active!.id, {
        status: (status || undefined) as IncidentStatus | undefined,
        priority: (priority || undefined) as IncidentPriority | undefined,
        category: (category || undefined) as IncidentCategory | undefined,
        q: debouncedQ || undefined,
        page: view === 'list' ? page : 1,
        limit: view === 'list' ? 20 : 100,
      }),
    [active?.id, status, priority, category, debouncedQ, page, view],
  )

  const setView = (next: 'list' | 'kanban' | 'calendar') => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev)
        if (next === 'list') {
          params.delete('view')
        } else {
          params.set('view', next)
        }
        params.delete('page')
        return params
      },
      { replace: true },
    )
  }

  const columns: Column<Incident>[] = [
    {
      key: 'reference',
      header: 'Referencia',
      sortable: true,
      sortValue: (incident) => incident.referenceCode,
      render: (incident) => (
        <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
          {incident.referenceCode}
        </span>
      ),
    },
    {
      key: 'title',
      header: 'Título',
      sortable: true,
      sortValue: (incident) => incident.title,
      render: (incident) => (
        <button
          type="button"
          className="text-left font-medium text-brand-700 dark:text-brand-400 hover:underline"
          onClick={() => navigate(`/c/${active!.id}/incidents/${incident.id}`)}
        >
          {incident.title}
        </button>
      ),
    },
    {
      key: 'category',
      header: 'Categoría',
      sortable: true,
      sortValue: (row) => CATEGORY_LABELS[row.category],
      render: (row) => CATEGORY_LABELS[row.category],
    },
    {
      key: 'priority',
      header: 'Prioridad',
      sortable: true,
      sortValue: (row) => row.priority,
      render: (row) => (
        <Badge tone={INCIDENT_PRIORITY_TONES[row.priority]}>{PRIORITY_LABELS[row.priority]}</Badge>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      sortable: true,
      sortValue: (row) => row.status,
      render: (row) => (
        <Badge tone={INCIDENT_STATUS_TONES[row.status]}>{STATUS_LABELS[row.status]}</Badge>
      ),
    },
    {
      key: 'createdAt',
      header: 'Creada',
      sortable: true,
      sortValue: (row) => row.createdAt,
      render: (row) => formatDate(row.createdAt),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Incidencias"
        actions={
          <div className="flex items-center gap-2">
            <Tabs
              items={[
                { value: 'list', label: 'Lista' },
                { value: 'kanban', label: 'Tablero' },
                { value: 'calendar', label: 'Calendario' },
              ]}
              value={view}
              onChange={(v) => setView(v as 'list' | 'kanban' | 'calendar')}
              ariaLabel="Vista de incidencias"
            />
            {role !== 'PROVIDER' && (
              <Button onClick={() => navigate(`/c/${active!.id}/incidents/new`)}>
                Nueva incidencia
              </Button>
            )}
          </div>
        }
      />

      <Card>
        <div className="grid gap-3 sm:grid-cols-4">
          <Select
            aria-label="Estado"
            value={status}
            onChange={(event) => setFilter('status', event.target.value)}
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
            onChange={(event) => setFilter('priority', event.target.value)}
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
            onChange={(event) => setFilter('category', event.target.value)}
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
            onChange={(event) => setFilter('q', event.target.value)}
          />
        </div>
      </Card>

      {result.loading ? (
        <SkeletonTable columns={6} />
      ) : result.error ? (
        <ErrorState error={result.error} onRetry={result.reload} />
      ) : result.data ? (
        view === 'kanban' ? (
          <IncidentKanban incidents={result.data.data} onChanged={result.reload} />
        ) : view === 'calendar' ? (
          <IncidentCalendar incidents={result.data.data} />
        ) : (
          <>
            <Card>
              <DataTable
                columns={columns}
                rows={result.data.data}
                rowKey={(row) => row.id}
                empty={
                  <EmptyState
                    icon={<EmptySearchIcon className="h-6 w-6" />}
                    title="No hay incidencias"
                    description="No se encontraron incidencias con estos filtros."
                    action={
                      role !== 'PROVIDER' ? (
                        <Button onClick={() => navigate(`/c/${active!.id}/incidents/new`)}>
                          Nueva incidencia
                        </Button>
                      ) : undefined
                    }
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
        )
      ) : null}
    </div>
  )
}
