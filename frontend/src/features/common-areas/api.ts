import { api } from '@/services/http'
import type { Availability, CommonArea, CommonAreaType } from './types'

export function listCommonAreas(communityId: string): Promise<CommonArea[]> {
  return api.get<CommonArea[]>(`/communities/${communityId}/common-areas`)
}

export interface CommonAreaInput {
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
}

export function createCommonArea(
  communityId: string,
  input: CommonAreaInput,
): Promise<CommonArea> {
  return api.post<CommonArea>(`/communities/${communityId}/common-areas`, input)
}

export function updateCommonArea(areaId: string, input: CommonAreaInput): Promise<CommonArea> {
  return api.put<CommonArea>(`/common-areas/${areaId}`, input)
}

export function getAvailability(areaId: string, date: string): Promise<Availability> {
  return api.get<Availability>(`/common-areas/${areaId}/availability`, { params: { date } })
}
