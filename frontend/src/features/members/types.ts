import type { MemberRole } from '@/types/roles'

export const MEMBER_STATUSES = ['ACTIVE', 'SUSPENDED', 'LEFT'] as const
export type MemberStatus = (typeof MEMBER_STATUSES)[number]

export interface Member {
  id: string
  userId: string
  fullName: string | null
  email: string | null
  unitNumber: string | null
  role: MemberRole
  status: MemberStatus
  joinedAt: string
  createdAt: string
  updatedAt: string
}

export interface Invitation {
  id: string
  email: string
  expiresAt: string
  acceptedAt: string | null
  createdAt: string
}

export interface InvitationCreated extends Invitation {
  code: string
}

export interface RedeemResult {
  memberId: string
  communityId: string
}

export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  ACTIVE: 'Activo',
  SUSPENDED: 'Suspendido',
  LEFT: 'Baja',
}
