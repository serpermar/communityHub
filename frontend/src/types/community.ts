import type { MemberRole } from './roles'

export interface Community {
  id: string
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
  createdAt: string
  updatedAt: string
  memberRole?: MemberRole
}

export interface CommunitySummary extends Community {
  memberRole: MemberRole
}

export interface CreateCommunityInput {
  name: string
  slug: string
  addressLine1: string
  city: string
  description?: string
  province?: string
  postalCode?: string
  country?: string
}
