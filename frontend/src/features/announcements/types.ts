export const ANNOUNCEMENT_TYPES = ['GENERAL', 'URGENT', 'MAINTENANCE', 'MEETING'] as const
export type AnnouncementType = (typeof ANNOUNCEMENT_TYPES)[number]

export const ANNOUNCEMENT_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const
export type AnnouncementPriority = (typeof ANNOUNCEMENT_PRIORITIES)[number]

export interface Announcement {
  id: string
  communityId: string
  title: string
  body: string
  type: AnnouncementType
  priority: AnnouncementPriority
  isPinned: boolean
  publishAt: string
  expiresAt: string | null
  authorId: string | null
  authorName: string | null
  createdAt: string
  updatedAt: string
}

export const ANNOUNCEMENT_TYPE_LABELS: Record<AnnouncementType, string> = {
  GENERAL: 'General',
  URGENT: 'Urgente',
  MAINTENANCE: 'Mantenimiento',
  MEETING: 'Reunión',
}

export const ANNOUNCEMENT_PRIORITY_LABELS: Record<AnnouncementPriority, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
}
