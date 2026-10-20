import { useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  Pagination,
  Select,
  SkeletonList,
  useToast,
  type Column,
} from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useAuth } from '@/context/AuthContext'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { t } from '@/i18n'
import { formatDateTime } from '@/utils/format'
import { cancelReservation, confirmReservation, listReservations } from '../api'
import { ReservationCalendar } from '../components/ReservationCalendar'
import { RESERVATION_STATUS_LABELS, type Reservation, type ReservationStatus } from '../types'

type View = 'list' | 'calendar'

export function ReservationListPage() {
  const { user } = useAuth()
  const { active, role } = useCommunity()
  const { notify } = useToast()
  const [view, setView] = useState<View>('list')
  const [status, setStatus] = useState<ReservationStatus | ''>('')
  const [date, setDate] = useState('')
  const [page, setPage] = useState(1)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const result = useResource(
    () =>
      listReservations(active!.id, {
        status: status || undefined,
        date: date || undefined,
        page,
        limit: 20,
      }),
    [active?.id, status, date, page],
  )

  const run = async (id: string, action: (reservationId: string) => Promise<unknown>) => {
    setActionError(null)
    setBusyId(id)
    try {
      await action(id)
      notify(t('toast.updated'), 'success')
      result.reload()
    } catch (caught) {
      setActionError(ApiError.from(caught).message)
    } finally {
      setBusyId(null)
    }
  }

  const columns: Column<Reservation>[] = [
    { key: 'area', header: 'Zona', render: (row) => row.commonAreaName },
    {
      key: 'when',
      header: 'Franja',
      render: (row) => `${formatDateTime(row.startsAt)} – ${formatDateTime(row.endsAt)}`,
    },
    { key: 'user', header: 'Reserva', render: (row) => row.userName ?? '—' },
    {
      key: 'status',
      header: 'Estado',
      render: (row) => (
        <Badge
          tone={row.status === 'CONFIRMED' ? 'green' : row.status === 'PENDING' ? 'amber' : 'slate'}
        >
          {RESERVATION_STATUS_LABELS[row.status]}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => {
        const canCancel =
          (row.status === 'PENDING' || row.status === 'CONFIRMED') &&
          (role === 'ADMIN' || row.userId === user?.id)
        const canConfirm = role === 'ADMIN' && row.status === 'PENDING'
        if (!canCancel && !canConfirm) return null
        return (
          <div className="flex justify-end gap-2">
            {canConfirm && (
              <Button
                size="sm"
                loading={busyId === row.id}
                onClick={() => run(row.id, confirmReservation)}
              >
                Confirmar
              </Button>
            )}
            {canCancel && (
              <Button
                size="sm"
                variant="danger"
                loading={busyId === row.id}
                onClick={() => run(row.id, cancelReservation)}
              >
                Cancelar
              </Button>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">
          {t('nav.reservations')}
        </h1>
        <div
          role="group"
          aria-label="Vista"
          className="inline-flex overflow-hidden rounded-md border border-slate-300 dark:border-slate-600"
        >
          <button
            type="button"
            onClick={() => setView('list')}
            aria-pressed={view === 'list'}
            className={`px-3 py-1 text-sm ${
              view === 'list'
                ? 'bg-brand-600 text-white'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            Lista
          </button>
          <button
            type="button"
            onClick={() => setView('calendar')}
            aria-pressed={view === 'calendar'}
            className={`px-3 py-1 text-sm ${
              view === 'calendar'
                ? 'bg-brand-600 text-white'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            Calendario
          </button>
        </div>
      </div>

      {view === 'calendar' ? (
        <ReservationCalendar />
      ) : (
        <>
          <Card>
            <div className="grid gap-3 sm:grid-cols-3">
              <Select
                aria-label="Estado"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as ReservationStatus | '')
                  setPage(1)
                }}
              >
                <option value="">Todos los estados</option>
                {(Object.keys(RESERVATION_STATUS_LABELS) as ReservationStatus[]).map((value) => (
                  <option key={value} value={value}>
                    {RESERVATION_STATUS_LABELS[value]}
                  </option>
                ))}
              </Select>
              <Input
                aria-label="Fecha"
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value)
                  setPage(1)
                }}
              />
            </div>
          </Card>

          {actionError && <Alert variant="error">{actionError}</Alert>}

          {result.loading ? (
            <SkeletonList />
          ) : result.error ? (
            <ErrorState error={result.error} onRetry={result.reload} />
          ) : result.data ? (
            <>
              <Card>
                <DataTable
                  columns={columns}
                  rows={result.data.data}
                  rowKey={(row) => row.id}
                  empty={<EmptyState title="No hay reservas" />}
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
        </>
      )}
    </div>
  )
}
