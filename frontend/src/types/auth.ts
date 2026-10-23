import type { GlobalRole, MemberRole } from './roles'

export interface AuthUser {
  id: string
  email: string
  fullName: string
  phone: string | null
  avatarUrl: string | null
  globalRole: GlobalRole
  emailVerifiedAt: string | null
  createdAt: string
}

export interface LoginCredentials {
  email: string
  password: string
}

export interface RegisterInput {
  email: string
  password: string
  fullName: string
  phone?: string
}

export interface LoginResult {
  accessToken: string
  expiresIn: number
  user: AuthUser
}

export interface SessionView {
  id: string
  current: boolean
  familyId: string
  expiresAt: string
  createdAt: string
  lastUsedAt: string | null
  userAgent: string | null
  ipAddress: string | null
}

export type PublicUser = AuthUser

export type MemberRoleValue = MemberRole
