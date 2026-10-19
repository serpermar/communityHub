import type { Notification } from './types'

/**
 * A que pantalla apunta una notificacion, segun su `payload`.
 *
 * Vive aparte para que la campana y la pagina de notificaciones compartan la
 * misma regla (antes estaba duplicada en la campana).
 */
export function notificationLink(notification: Notification): string | null {
  const payload = notification.payload as Record<string, unknown>
  const communityId = notification.communityId
  if (!communityId) return null
  if (typeof payload.incidentId === 'string') {
    return `/c/${communityId}/incidents/${payload.incidentId}`
  }
  if (typeof payload.voteId === 'string') {
    return `/c/${communityId}/votes/${payload.voteId}`
  }
  if (typeof payload.announcementId === 'string') {
    return `/c/${communityId}/announcements`
  }
  if (typeof payload.reservationId === 'string') {
    return `/c/${communityId}/reservations`
  }
  return null
}
