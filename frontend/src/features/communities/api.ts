import { api } from '@/services/http'
import type { Community, CommunitySummary, CreateCommunityInput } from '@/types/community'

export function listCommunities(): Promise<CommunitySummary[]> {
  return api.get<CommunitySummary[]>('/communities')
}

export function getCommunity(communityId: string): Promise<Community> {
  return api.get<Community>(`/communities/${communityId}`)
}

export function createCommunity(input: CreateCommunityInput): Promise<CommunitySummary> {
  return api.post<CommunitySummary>('/communities', input)
}

export type UpdateCommunityInput = Partial<{
  name: string
  slug: string
  description: string | null
  addressLine1: string
  city: string
  province: string | null
  postalCode: string | null
  country: string
  latitude: number | null
  longitude: number | null
  timezone: string
  registrationNumber: string | null
  isActive: boolean
}>

export function updateCommunity(
  communityId: string,
  input: UpdateCommunityInput,
): Promise<Community> {
  return api.patch<Community>(`/communities/${communityId}`, input)
}

export interface GeocodeResult {
  latitude: number
  longitude: number
  formattedAddress: string
  source: string
}

export function geocodeCommunity(communityId: string): Promise<GeocodeResult> {
  return api.post<GeocodeResult>(`/communities/${communityId}/geocode`)
}

export interface CommunityWeather {
  location: {
    city: string
    latitude: number
    longitude: number
    timezone: string
  }
  current: {
    temperatureC: number
    apparentTemperatureC: number
    weatherCode: number
    condition: string
    isDay: boolean
  }
  today: {
    minC: number
    maxC: number
    precipitationProbability: number
    sunrise: string
    sunset: string
  }
  updatedAt: string
  source: string
}

export function getCommunityWeather(communityId: string): Promise<CommunityWeather | null> {
  return api.get<CommunityWeather | null>(`/communities/${communityId}/weather`)
}
