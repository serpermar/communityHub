import { api, API_BASE_URL } from '@/services/http'
import { getAccessToken } from '@/services/session'
import { ApiError } from '@/services/ApiError'
import type { ListResult } from '@/types/api'
import type {
  AiTool,
  ChatEvent,
  ChatMessage,
  ChatSession,
  ChatStreamBody,
  IncidentDraft,
  IncidentProposal,
} from './types'
import type { Incident, IncidentCategory, IncidentPriority } from '@/features/incidents/types'

type SimpleMeta = { page: number; limit: number; total: number }

export function listSessions(): Promise<ListResult<ChatSession, SimpleMeta>> {
  return api.list<ChatSession, SimpleMeta>('/ai/chat/sessions')
}

export function listMessages(sessionId: string): Promise<ListResult<ChatMessage, SimpleMeta>> {
  return api.list<ChatMessage, SimpleMeta>(`/ai/chat/sessions/${sessionId}/messages`)
}

export function deleteSession(sessionId: string): Promise<void> {
  return api.delete<void>(`/ai/chat/sessions/${sessionId}`)
}

export function listTools(): Promise<AiTool[]> {
  return api.get<AiTool[]>('/ai/tools')
}

export function classifyIncident(
  communityId: string,
  description: string,
): Promise<IncidentProposal> {
  return api.post<IncidentProposal>('/ai/incidents/classify', { communityId, description })
}

export function createIncidentDraft(
  communityId: string,
  description: string,
): Promise<IncidentDraft> {
  return api.post<IncidentDraft>('/ai/incidents/drafts', { communityId, description })
}

export interface ConfirmDraftInput {
  title?: string
  description?: string
  category?: IncidentCategory
  priority?: IncidentPriority
  location?: string
}

export function confirmIncidentDraft(draftId: string, input: ConfirmDraftInput): Promise<Incident> {
  return api.post<Incident>(`/ai/incidents/drafts/${draftId}/confirm`, input)
}

export interface StreamHandlers {
  onEvent: (event: ChatEvent) => void
}

/**
 * El chat usa SSE sobre `POST`, por lo que no vale `EventSource`: se lee el
 * cuerpo de la respuesta con `fetch` y se parsean los frames `data:`.
 */
export async function streamChat(
  body: ChatStreamBody,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const token = getAccessToken()
  const response = await fetch(`${API_BASE_URL}/ai/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    let payload: { error?: { code: string; message: string } } | undefined
    try {
      payload = (await response.json()) as typeof payload
    } catch {
      payload = undefined
    }
    throw new ApiError(response.status, {
      code: payload?.error?.code ?? 'AI_ERROR',
      message: payload?.error?.message ?? 'No se pudo contactar con el asistente.',
    })
  }

  const reader = response.body?.getReader()
  if (!reader) throw new ApiError(0, { code: 'AI_ERROR', message: 'Respuesta sin cuerpo.' })

  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let separator = buffer.indexOf('\n\n')
    while (separator !== -1) {
      const frame = buffer.slice(0, separator)
      buffer = buffer.slice(separator + 2)
      const dataLine = frame.split('\n').find((line) => line.startsWith('data:'))
      if (dataLine) {
        try {
          handlers.onEvent(JSON.parse(dataLine.slice(5).trim()) as ChatEvent)
        } catch {
          // Ignora frames malformados.
        }
      }
      separator = buffer.indexOf('\n\n')
    }
  }
}
