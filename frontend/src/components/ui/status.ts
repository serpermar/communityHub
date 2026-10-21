// ---------------------------------------------------------------------------
// Color de estado: fuente unica para traducir el estado de una entidad a un
// *tone* del `Badge`. Antes cada pagina definia su propio mapa o ternario, con
// inconsistencias (p. ej. CANCELLED salia `blue` en el detalle de incidencia y
// `slate` en el listado). Aqui vive la unica tabla.
//
// El `tone` se mapea a los colores semanticos en `Badge` (ver `Display.tsx`).
// ---------------------------------------------------------------------------

import type { IncidentPriority, IncidentStatus } from '@/features/incidents/types'
import type { ReservationStatus } from '@/features/reservations/types'
import type { VoteStatus } from '@/features/voting/types'
import type { InvoiceStatus } from '@/features/finance/types'
import type { MemberStatus } from '@/features/members/types'
import type { AnnouncementType } from '@/features/announcements/types'

export type BadgeTone = 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'violet'

export const INCIDENT_STATUS_TONES: Record<IncidentStatus, BadgeTone> = {
  OPEN: 'blue',
  IN_PROGRESS: 'amber',
  RESOLVED: 'green',
  CANCELLED: 'slate',
}

export const INCIDENT_PRIORITY_TONES: Record<IncidentPriority, BadgeTone> = {
  LOW: 'slate',
  MEDIUM: 'blue',
  HIGH: 'amber',
  CRITICAL: 'red',
}

export const RESERVATION_STATUS_TONES: Record<ReservationStatus, BadgeTone> = {
  PENDING: 'amber',
  CONFIRMED: 'green',
  CANCELLED: 'slate',
}

export const VOTE_STATUS_TONES: Record<VoteStatus, BadgeTone> = {
  DRAFT: 'slate',
  OPEN: 'green',
  CLOSED: 'amber',
}

export const INVOICE_STATUS_TONES: Record<InvoiceStatus, BadgeTone> = {
  PENDING: 'amber',
  PAID: 'green',
  OVERDUE: 'red',
  CANCELLED: 'slate',
}

export const MEMBER_STATUS_TONES: Record<MemberStatus, BadgeTone> = {
  ACTIVE: 'green',
  SUSPENDED: 'amber',
  LEFT: 'slate',
}

export const ANNOUNCEMENT_TYPE_TONES: Record<AnnouncementType, BadgeTone> = {
  GENERAL: 'slate',
  URGENT: 'red',
  MAINTENANCE: 'amber',
  MEETING: 'blue',
}
