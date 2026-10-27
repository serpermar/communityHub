import { useEffect, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Pagination,
  Select,
  SkeletonTable,
  useToast,
  RESERVATION_STATUS_TONES,
  type Column,
} from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useAuth } from '@/context/AuthContext'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { useUrlFilters } from '@/hooks/useUrlFilters'
import { t } from '@/i18n'
import { formatDateTime } from '@/utils/format'
import { cancelReservation, confirmReservation, listReservations } from '../api'
import { ReservationCalendar } from '../components/ReservationCalendar'
import { RESERVATION_STATUS_LABELS, type Reservation, type ReservationStatus } from '../types'
import { getHolidays } from '@/features/dashboard/api'
import type { PublicHoliday } from '@/features/dashboard/types'
import styles from './ReservationListPage.module.css'

type View = 'list' | 'calendar'

export function ReservationListPage() {
  const { user } = useAuth()
  const { active, role } = useCommunity()
  const { notify } = useToast()
  const { filters, page, setFilter, setPage } = useUrlFilters({
    status: Object.keys(RESERVATION_STATUS_LABELS),
    date: undefined,
    view: ['list', 'calendar'] as const,
  })
  const { status, date } = filters
  const view = (filters.view || 'list') as View
  const setView = (next: View) => setFilter('view', next)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [holidays, setHolidays] = useState<PublicHoliday[]>([])

  const result = useResource(
    () =>
      listReservations(active!.id, {
        status: (status || undefined) as ReservationStatus | undefined,
        date: date || undefined,
        page,
        limit: 20,
      }),
    [active?.id, status, date, page],
  )

  useEffect(() => {
    if (!active?.id) return
    const year = new Date().getFullYear()
    getHolidays(active.id, { year })
      .then(setHolidays)
      .catch(() => setHolidays([]))
  }, [active?.id])

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
        <Badge tone={RESERVATION_STATUS_TONES[row.status]}>
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
          <div className={styles.rowActions}>
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
    <div className={styles.page}>
      <PageHeader
        title={t('nav.reservations')}
        actions={
          <div role="group" aria-label="Vista" className={styles.viewGroup}>
            <button
              type="button"
              onClick={() => setView('list')}
              aria-pressed={view === 'list'}
              className={`${styles.viewButton} ${view === 'list' ? styles.viewButtonActive : ''}`}
            >
              Lista
            </button>
            <button
              type="button"
              onClick={() => setView('calendar')}
              aria-pressed={view === 'calendar'}
              className={`${styles.viewButton} ${
                view === 'calendar' ? styles.viewButtonActive : ''
              }`}
            >
              Calendario
            </button>
          </div>
        }
      />

      {view === 'calendar' ? (
        <ReservationCalendar />
      ) : (
        <>
          <Card>
            <div className={styles.filtersGrid}>
              <Select
                aria-label="Estado"
                value={status}
                onChange={(event) => setFilter('status', event.target.value)}
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
                onChange={(event) => setFilter('date', event.target.value)}
              />
            </div>
            {date && holidays.some((h) => h.date === date) && (
              <p className={styles.holidayText}>
                {holidays.find((h) => h.date === date)?.localName || 'Festivo'}
              </p>
            )}
          </Card>

          {actionError && <Alert variant="error">{actionError}</Alert>}

          {result.loading ? (
            <SkeletonTable columns={5} />
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
                      title="No hay reservas"
                      description="Reserva una zona común desde su ficha."
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
        </>
      )}
    </div>
  )
}
