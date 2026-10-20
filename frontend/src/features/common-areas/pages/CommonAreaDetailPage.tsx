import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Textarea,
} from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { formatDateTime } from '@/utils/format'
import { getAvailability, listCommonAreas } from '../api'
import { createReservation } from '@/features/reservations/api'
import { COMMON_AREA_TYPE_LABELS, type AvailabilitySlot } from '../types'

export function CommonAreaDetailPage() {
  const { areaId } = useParams<{ commonAreaId?: string; areaId?: string }>()
  const navigate = useNavigate()
  const { active, role } = useCommunity()
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [selected, setSelected] = useState<AvailabilitySlot | null>(null)
  const [attendees, setAttendees] = useState('')
  const [notes, setNotes] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const areaIdValue = areaId!
  const areas = useResource(() => listCommonAreas(active!.id), [active?.id])
  const availability = useResource(() => getAvailability(areaIdValue, date), [areaIdValue, date])

  const area = areas.data?.find((item) => item.id === areaIdValue)
  const canReserve = role === 'ADMIN' || role === 'PRESIDENT' || role === 'NEIGHBOR'

  const onReserve = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selected) return
    setServerError(null)
    setSubmitting(true)
    try {
      await createReservation(areaIdValue, {
        startsAt: selected.startsAt,
        endsAt: selected.endsAt,
        attendees: attendees ? Number(attendees) : undefined,
        notes: notes || undefined,
      })
      navigate(`/c/${active!.id}/reservations`)
    } catch (caught) {
      setServerError(ApiError.from(caught).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (areas.loading) return <LoadingState />
  if (areas.error) return <ErrorState error={areas.error} onRetry={areas.reload} />
  if (!area) return <EmptyState title="Zona no encontrada" />

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <button
        type="button"
        onClick={() => navigate(`/c/${active!.id}/common-areas`)}
        className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-700 dark:hover:text-brand-400"
      >
        ← Volver a zonas comunes
      </button>

      <Card>
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{area.name}</h1>
          <Badge tone={area.isActive ? 'green' : 'slate'}>
            {area.isActive ? 'Activa' : 'Baja'}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {COMMON_AREA_TYPE_LABELS[area.type]} · franjas de {area.slotMinutes} min · {area.openTime}
          –{area.closeTime}
          {area.requiresApproval && ' · requiere aprobación'}
        </p>
      </Card>

      <Card title="Disponibilidad">
        <Field label="Día" htmlFor="date">
          <Input
            id="date"
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value)
              setSelected(null)
            }}
          />
        </Field>

        {availability.loading ? (
          <div className="mt-4">
            <LoadingState />
          </div>
        ) : availability.error ? (
          <div className="mt-4">
            <ErrorState error={availability.error} onRetry={availability.reload} />
          </div>
        ) : availability.data && availability.data.slots.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {availability.data.slots.map((slot) => {
              const isSelected = selected?.startsAt === slot.startsAt
              return (
                <button
                  key={slot.startsAt}
                  type="button"
                  disabled={slot.status === 'OCCUPIED'}
                  onClick={() => setSelected(slot)}
                  className={`rounded-md border px-2 py-1 text-sm ${
                    slot.status === 'OCCUPIED'
                      ? 'cursor-not-allowed border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'
                      : isSelected
                        ? 'border-brand-600 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-950 dark:text-brand-300'
                        : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-brand-400'
                  }`}
                >
                  {slot.startsAt.slice(11, 16)}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No hay franjas ese día.</p>
        )}
      </Card>

      {selected && (
        <Card title="Reservar franja">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {formatDateTime(selected.startsAt)} – {formatDateTime(selected.endsAt)}
          </p>
          {serverError && (
            <div className="mt-3">
              <Alert variant="error">{serverError}</Alert>
            </div>
          )}
          {!area.isActive ? (
            <Alert variant="warning" className="mt-3">
              La zona está dada de baja y no admite reservas nuevas.
            </Alert>
          ) : !canReserve ? (
            <Alert variant="warning" className="mt-3">
              Tu rol no permite reservar.
            </Alert>
          ) : (
            <form className="mt-4 space-y-3" onSubmit={onReserve} noValidate>
              <Field label="Asistentes" htmlFor="attendees">
                <Input
                  id="attendees"
                  type="number"
                  min={1}
                  value={attendees}
                  onChange={(event) => setAttendees(event.target.value)}
                />
              </Field>
              <Field label="Notas" htmlFor="notes">
                <Textarea
                  id="notes"
                  rows={2}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </Field>
              <div className="flex justify-end">
                <Button type="submit" loading={submitting}>
                  Reservar
                </Button>
              </div>
            </form>
          )}
        </Card>
      )}
    </div>
  )
}
