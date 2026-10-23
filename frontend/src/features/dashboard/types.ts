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
      publishAt: string
    }[]
  }
  votes: {
    open: {
      id: string
      title: string
      endsAt: string
      status: string
    }[]
  }
  finance?: {
    expenseTotal: number
    invoiceOpenAmount: number
    invoiceOverdueCount: number
    expensesByMonth: { month: string; total: number }[]
  }
}

export interface PublicHoliday {
  date: string
  localName: string
  name: string
  countryCode: string
  fixed: boolean
  global: boolean
  counties: string[] | null
  launchYear: number | null
  types: string[]
}

export interface CurrentWeather {
  temperature: number
  apparentTemperature: number
  weatherCode: number
  windSpeed: number
  precipitation: number
  time: string
}
