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
  LoadingState,
  Pagination,
  Select,
  type Column,
} from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useAuth } from '@/context/AuthContext'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { formatDateTime } from '@/utils/format'
import { cancelReservation, confirmReservation, listReservations } from '../api'
import { RESERVATION_STATUS_LABELS, type Reservation, type ReservationStatus } from '../types'

export function ReservationListPage() {
  const { user } = useAuth()
  const { active, role } = useCommunity()
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
      result.reload()
    } catch (caught) {
      setActionError(ApiError.from(caught).message)
    } finally {
      setBusyId(null)
    }
  }

  const columns: Column<Reservation>[] = [
    { key: 'area', header: 'Zona', render: (row) => row.commonAreaName },
    { key: 'when', header: 'Franja', render: (row) => `${formatDateTime(row.startsAt)} – ${formatDateTime(row.endsAt)}` },
    { key: 'user', header: 'Reserva', render: (row) => row.userName ?? '—' },
    {
      key: 'status',
      header: 'Estado',
      render: (row) => (
        <Badge
          tone={
            row.status === 'CONFIRMED' ? 'green' : row.status === 'PENDING' ? 'amber' : 'slate'
          }
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
      <h1 className="text-xl font-semibold text-slate-800">Reservas</h1>

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
    </div>
  )
}
