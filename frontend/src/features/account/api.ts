import { api } from '@/services/http'
import type { AuthUser, SessionView } from '@/types/auth'

export function listSessions(): Promise<SessionView[]> {
  return api.get<SessionView[]>('/auth/sessions')
}

export function revokeSession(sessionId: string): Promise<void> {
  return api.delete<void>(`/auth/sessions/${sessionId}`)
}

export function updateProfile(input: { fullName: string; phone?: string }): Promise<AuthUser> {
  return api.patch<AuthUser>('/auth/me', input)
}

export function changePassword(input: {
  currentPassword: string
  newPassword: string
}): Promise<void> {
  return api.post<void>('/auth/change-password', input)
}
