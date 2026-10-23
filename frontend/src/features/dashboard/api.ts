import { api } from '@/services/http'
import type { CurrentWeather, DashboardView, PublicHoliday } from './types'

export function getDashboard(
  communityId: string,
  query?: { from?: string; to?: string },
): Promise<DashboardView> {
  return api.get<DashboardView>(`/communities/${communityId}/dashboard`, { params: query })
}

export function getHolidays(
  communityId: string,
  query?: { year?: number; countryCode?: string },
): Promise<PublicHoliday[]> {
  return api.get<PublicHoliday[]>(`/communities/${communityId}/holidays`, { params: query })
}

export function getWeather(
  communityId: string,
  query: { lat: number; lon: number },
): Promise<CurrentWeather | null> {
  return api.get<CurrentWeather | null>(`/communities/${communityId}/weather`, { params: query })
}
