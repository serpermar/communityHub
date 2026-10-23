import { api } from '@/services/http'
import type { AuthUser, SessionView } from '@/types/auth'
import type { PublicUser } from '@/types/auth'

export function listSessions(): Promise<SessionView[]> {
  return api.get<SessionView[]>('/auth/sessions')
}

export function revokeSession(sessionId: string): Promise<void> {
  return api.delete<void>(`/auth/sessions/${sessionId}`)
}

export function updateProfile(input: { fullName: string; phone?: string }): Promise<AuthUser> {
  return api.patch<AuthUser>('/auth/me', input)
}

export function uploadAvatar(file: File): Promise<PublicUser> {
  const formData = new FormData()
  formData.append('avatar', file)
  return api.post<PublicUser>('/auth/me/avatar', formData)
}

export function deleteAvatar(): Promise<PublicUser> {
  return api.delete<PublicUser>('/auth/me/avatar')
}

export function changePassword(input: {
  currentPassword: string
  newPassword: string
}): Promise<void> {
  return api.post<void>('/auth/change-password', input)
}
