export type NotificationType =
  | 'INCIDENT_CREATED'
  | 'INCIDENT_UPDATED'
  | 'RESERVATION_CREATED'
  | 'RESERVATION_CANCELLED'
  | 'ANNOUNCEMENT_NEW'
  | 'VOTE_OPEN'
  | 'VOTE_CLOSED'
  | 'MEMBER_JOINED'

export interface Notification {
  id: string
  type: NotificationType
  title: string
  body: string
  payload: Record<string, unknown>
  communityId: string | null
  readAt: string | null
  createdAt: string
}
