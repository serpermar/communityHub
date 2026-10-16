export type ReservationStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED'

export interface Reservation {
  id: string
  communityId: string
  communityName: string | null
  commonAreaId: string
  commonAreaName: string
  startsAt: string
  endsAt: string
  status: ReservationStatus
  attendees: number | null
  notes: string | null
  cancelledAt: string | null
  userId: string
  userName: string | null
  createdAt: string
  updatedAt: string
}

export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Cancelada',
}
