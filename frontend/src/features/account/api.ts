import { api } from '@/services/http'
import type { SessionView } from '@/types/auth'

export function listSessions(): Promise<SessionView[]> {
  return api.get<SessionView[]>('/auth/sessions')
}

export function revokeSession(sessionId: string): Promise<void> {
  return api.delete<void>(`/auth/sessions/${sessionId}`)
}
