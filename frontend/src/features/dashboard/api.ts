import { api } from '@/services/http'
import type { DashboardView } from './types'

export function getDashboard(
  communityId: string,
  query?: { from?: string; to?: string },
): Promise<DashboardView> {
  return api.get<DashboardView>(`/communities/${communityId}/dashboard`, { params: query })
}
