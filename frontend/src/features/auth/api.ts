import { api } from '@/services/http'

export async function requestPasswordReset(email: string): Promise<{ message: string }> {
  return api.post<{ message: string }>('/auth/forgot-password', { email })
}
