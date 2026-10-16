import { api, cleanParams } from '@/services/http'
import type { ListResult } from '@/types/api'
import type { Notification } from './types'

export function listNotifications(params: {
  unread?: boolean
  page?: number
  limit?: number
}): Promise<ListResult<Notification>> {
  return api.list<Notification>('/notifications', {
    params: cleanParams({
      unread: params.unread === undefined ? undefined : String(params.unread),
      page: params.page,
      limit: params.limit,
    }),
  })
}

export function getUnreadCount(): Promise<{ count: number }> {
  return api.get<{ count: number }>('/notifications/unread-count')
}

export function markNotificationRead(id: string): Promise<Notification> {
  return api.patch<Notification>(`/notifications/${id}/read`)
}

export function markAllNotificationsRead(): Promise<{ updated: number }> {
  return api.post<{ updated: number }>('/notifications/read-all')
}
