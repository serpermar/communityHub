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
  SkeletonDetail,
  SkeletonList,
  Textarea,
} from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { formatDateTime } from '@/utils/format'
import { getAvailability, listCommonAreas } from '../api'
import { createReservation } from '@/features/reservations/api'
import { COMMON_AREA_TYPE_LABELS, type AvailabilitySlot } from '../types'
import styles from './CommonAreaDetailPage.module.css'

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

  if (areas.loading) return <SkeletonDetail />
  if (areas.error) return <ErrorState error={areas.error} onRetry={areas.reload} />
  if (!area) return <EmptyState title="Zona no encontrada" />

  return (
    <div className={styles.page}>
      <button
        type="button"
        onClick={() => navigate(`/c/${active!.id}/common-areas`)}
        className={styles.backButton}
      >
        ← Volver a zonas comunes
      </button>

      <Card>
        <div className={styles.headerRow}>
          <h1 className={styles.title}>{area.name}</h1>
          <Badge tone={area.isActive ? 'green' : 'slate'}>
            {area.isActive ? 'Activa' : 'Baja'}
          </Badge>
        </div>
        <p className={styles.meta}>
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
          <div className={styles.mt4}>
            <SkeletonList rows={2} />
          </div>
        ) : availability.error ? (
          <div className={styles.mt4}>
            <ErrorState error={availability.error} onRetry={availability.reload} />
          </div>
        ) : availability.data && availability.data.slots.length > 0 ? (
          <div className={styles.slotsGrid}>
            {availability.data.slots.map((slot) => {
              const isSelected = selected?.startsAt === slot.startsAt
              const slotClass =
                slot.status === 'OCCUPIED'
                  ? styles.slotButtonOccupied
                  : isSelected
                    ? styles.slotButtonSelected
                    : ''
              return (
                <button
                  key={slot.startsAt}
                  type="button"
                  disabled={slot.status === 'OCCUPIED'}
                  onClick={() => setSelected(slot)}
                  className={`${styles.slotButton} ${slotClass}`}
                >
                  {slot.startsAt.slice(11, 16)}
                </button>
              )
            })}
          </div>
        ) : (
          <p className={styles.emptySlots}>No hay franjas ese día.</p>
        )}
      </Card>

      {selected && (
        <Card title="Reservar franja">
          <p className={styles.selectedRange}>
            {formatDateTime(selected.startsAt)} – {formatDateTime(selected.endsAt)}
          </p>
          {serverError && (
            <div className={styles.mt3}>
              <Alert variant="error">{serverError}</Alert>
            </div>
          )}
          {!area.isActive ? (
            <Alert variant="warning" className={styles.mt3}>
              La zona está dada de baja y no admite reservas nuevas.
            </Alert>
          ) : !canReserve ? (
            <Alert variant="warning" className={styles.mt3}>
              Tu rol no permite reservar.
            </Alert>
          ) : (
            <form className={styles.reserveForm} onSubmit={onReserve} noValidate>
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
              <div className={styles.formFooter}>
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
