import type { AnnouncementPriority, AnnouncementType } from '@/features/announcements/types'
import type { IncidentCategory, IncidentStatus } from '@/features/incidents/types'
import type { ReservationStatus } from '@/features/reservations/types'

export interface DashboardView {
  community: {
    id: string
    name: string
    city: string
    neighborCount: number
    memberCount: number
  }
  incidents: {
    open: number
    inProgress: number
    pending: number
    critical: number
    byStatus: { status: IncidentStatus; count: number }[]
    byCategory: { category: IncidentCategory; count: number }[]
  }
  reservations: {
    upcomingCount: number
    upcoming: {
      id: string
      commonAreaId: string
      commonAreaName: string | null
      startsAt: string
      endsAt: string
      status: ReservationStatus
      userId: string
      userName: string | null
    }[]
    byMonth: { month: string; count: number }[]
  }
  announcements: {
    latest: {
      id: string
      title: string
      type: AnnouncementType
      priority: AnnouncementPriority
      isPinned: boolean
      publishAt: string
    }[]
  }
  votes: {
    openCount: number
    open: { id: string; title: string; endsAt: string }[]
  }
  finance: {
    expenseTotal: number
    expenseCount: number
    invoiceOpenAmount: number
    invoicePendingCount: number
    invoiceOverdueCount: number
    expensesByMonth: { month: string; total: number }[]
  } | null
}
