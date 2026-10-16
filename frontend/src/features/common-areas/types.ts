export const COMMON_AREA_TYPES = [
  'PADEL_COURT',
  'SWIMMING_POOL',
  'COMMUNITY_ROOM',
  'GYM',
  'TERRACE',
  'PLAYGROUND',
  'GARAGE',
  'OTHER',
] as const

export type CommonAreaType = (typeof COMMON_AREA_TYPES)[number]

export interface CommonArea {
  id: string
  communityId: string
  name: string
  type: CommonAreaType
  description: string | null
  capacity: number | null
  slotMinutes: number
  openTime: string
  closeTime: string
  maxDailyReservations: number | null
  requiresApproval: boolean
  isActive: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export type SlotStatus = 'FREE' | 'OCCUPIED'

export interface AvailabilitySlot {
  startsAt: string
  endsAt: string
  status: SlotStatus
}

export interface Availability {
  date: string
  slotMinutes: number
  openTime: string
  closeTime: string
  slots: AvailabilitySlot[]
}

export const COMMON_AREA_TYPE_LABELS: Record<CommonAreaType, string> = {
  PADEL_COURT: 'Pista de pádel',
  SWIMMING_POOL: 'Piscina',
  COMMUNITY_ROOM: 'Sala comunitaria',
  GYM: 'Gimnasio',
  TERRACE: 'Terraza',
  PLAYGROUND: 'Parque infantil',
  GARAGE: 'Garaje',
  OTHER: 'Otros',
}
