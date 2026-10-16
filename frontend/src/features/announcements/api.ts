import { api, cleanParams } from '@/services/http'
import type { ListResult } from '@/types/api'
import type { Announcement, AnnouncementPriority, AnnouncementType } from './types'

export interface AnnouncementListQuery {
  type?: AnnouncementType
  q?: string
  page?: number
  limit?: number
}

export function listAnnouncements(
  communityId: string,
  query: AnnouncementListQuery,
): Promise<ListResult<Announcement>> {
  return api.list<Announcement>(`/communities/${communityId}/announcements`, {
    params: cleanParams({ ...query }),
  })
}

export interface AnnouncementInput {
  title: string
  body: string
  type: AnnouncementType
  priority: AnnouncementPriority
  isPinned: boolean
  publishAt: string
  expiresAt: string | null
}

export function createAnnouncement(
  communityId: string,
  input: AnnouncementInput,
): Promise<Announcement> {
  return api.post<Announcement>(`/communities/${communityId}/announcements`, input)
}

export function updateAnnouncement(
  announcementId: string,
  input: AnnouncementInput,
): Promise<Announcement> {
  return api.put<Announcement>(`/announcements/${announcementId}`, input)
}

export function deleteAnnouncement(announcementId: string): Promise<{ id: string; deleted: boolean }> {
  return api.delete<{ id: string; deleted: boolean }>(`/announcements/${announcementId}`)
}
