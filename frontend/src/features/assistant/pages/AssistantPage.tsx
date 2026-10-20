import { useState } from 'react'
import { Alert, Button, Card, Spinner } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { deleteSession, listMessages, listSessions, streamChat } from '../api'
import type { ChatCitation, ChatMessage, ChatToolCall } from '../types'

interface RenderedMessage {
  id: string
  role: string
  content: string
  toolCalls: ChatToolCall[]
  citations: ChatCitation[]
}

function ensureTrace(message: RenderedMessage): RenderedMessage {
  return {
    ...message,
    toolCalls: message.toolCalls ?? [],
    citations: message.citations ?? [],
  }
}

/** Nombre legible de una tool interna (`list_incidents` -> "Listar incidencias"). */
function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    list_incidents: 'Consultar incidencias',
    get_incident: 'Leer una incidencia',
    list_announcements: 'Consultar avisos',
    list_votes: 'Consultar votaciones',
    list_reservations: 'Consultar reservas',
    prepare_incident_draft: 'Preparar borrador de incidencia',
  }
  return labels[name] ?? name
}

/**
 * Enlaces a los objetos citados por el asistente (AI-8).
 *
 * Una cita trae el nombre de la tool y los ids que devolvio. Se enlazan a la
 * pantalla mas util posible: incidencias y votaciones tienen detalle propio; el
 * resto va al listado del modulo.
 */
function citationLink(communityId: string, citation: ChatCitation, id: string): string {
  switch (citation.tool) {
    case 'list_incidents':
    case 'get_incident':
      return `/c/${communityId}/incidents/${id}`
    case 'list_votes':
      return `/c/${communityId}/votes/${id}`
    case 'list_announcements':
      return `/c/${communityId}/announcements`
    case 'list_reservations':
      return `/c/${communityId}/reservations`
    default:
      return `/c/${communityId}/dashboard`
  }
}

export function AssistantPage() {
  const { active } = useCommunity()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<RenderedMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sessions = useResource(() => listSessions(), [])

  const openSession = async (id: string) => {
    setError(null)
    setSessionId(id)
    try {
      const result = await listMessages(id)
      setMessages(
        result.data.map((message: ChatMessage) =>
          ensureTrace({
            id: message.id,
            role: message.role,
            content: message.content,
            toolCalls: message.toolCalls ?? [],
            citations: message.citations ?? [],
          }),
        ),
      )
    } catch (caught) {
      setError(ApiError.from(caught).message)
    }
  }

  const newChat = () => {
    setSessionId(null)
    setMessages([])
    setError(null)
  }

  const removeSession = async (id: string) => {
    try {
      await deleteSession(id)
      if (sessionId === id) newChat()
      sessions.reload()
    } catch (caught) {
      setError(ApiError.from(caught).message)
    }
  }

  const send = async (event: React.FormEvent) => {
    event.preventDefault()
    const text = input.trim()
    if (!text || streaming) return
    setError(null)
    setInput('')
    const userMessage: RenderedMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      toolCalls: [],
      citations: [],
    }
    const assistantId = `a-${Date.now()}`
    setMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: 'assistant', content: '', toolCalls: [], citations: [] },
    ])
    setStreaming(true)
    try {
      await streamChat(
        { message: text, sessionId: sessionId ?? undefined, communityId: active?.id },
        {
          onEvent: (event) => {
            if (event.type === 'meta') {
              setSessionId(event.sessionId)
            } else if (event.type === 'token') {
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? { ...message, content: message.content + event.delta }
                    : message,
                ),
              )
            } else if (event.type === 'tool_call') {
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? {
                        ...message,
                        toolCalls: [...message.toolCalls, { name: event.name, args: event.args }],
                      }
                    : message,
                ),
              )
            } else if (event.type === 'citation') {
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantId
                    ? {
                        ...message,
                        citations: [...message.citations, { tool: event.tool, ids: event.ids }],
                      }
                    : message,
                ),
              )
            } else if (event.type === 'error') {
              setError(event.message)
            }
          },
        },
      )
      sessions.reload()
    } catch (caught) {
      setError(ApiError.from(caught).message)
    } finally {
      setStreaming(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <Card
        title="Conversaciones"
        actions={
          <Button size="sm" variant="secondary" onClick={newChat}>
            Nueva
          </Button>
        }
      >
        {sessions.loading ? (
          <Spinner />
        ) : sessions.data && sessions.data.data.length > 0 ? (
          <ul className="space-y-1">
            {sessions.data.data.map((session) => (
              <li key={session.id} className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => void openSession(session.id)}
                  className={`flex-1 truncate rounded-md px-2 py-1 text-left text-sm ${
                    sessionId === session.id
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  {session.title ?? 'Conversación'}
                </button>
                <button
                  type="button"
                  aria-label="Eliminar conversación"
                  className="text-xs text-slate-400 hover:text-red-600 dark:text-slate-500 dark:hover:text-red-400"
                  onClick={() => void removeSession(session.id)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">Sin conversaciones.</p>
        )}
      </Card>

      <Card title="Asistente">
        <div className="flex h-[28rem] flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            {messages.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Pregunta sobre incidencias, reservas, avisos o votaciones de la comunidad.
              </p>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    message.role === 'user'
                      ? 'ml-auto bg-brand-600 text-white'
                      : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
                  }`}
                >
                  {message.content || <span className="text-slate-400 dark:text-slate-500">…</span>}

                  {message.role !== 'user' && message.toolCalls.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1">
                      {message.toolCalls.map((call, index) => (
                        <li
                          key={`${call.name}-${index}`}
                          className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-700 dark:text-slate-200"
                        >
                          🔧 {toolLabel(call.name)}
                        </li>
                      ))}
                    </ul>
                  )}

                  {message.role !== 'user' && message.citations.length > 0 && (
                    <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-700">
                      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Fuentes
                      </span>
                      <ul className="mt-1 flex flex-wrap gap-1">
                        {message.citations.flatMap((citation, ci) =>
                          citation.ids.map((id) => (
                            <li key={`${citation.tool}-${ci}-${id}`}>
                              <button
                                type="button"
                                onClick={() =>
                                  active &&
                                  window.open(citationLink(active.id, citation, id), '_self')
                                }
                                className="rounded-md bg-white px-2 py-0.5 text-[11px] text-brand-700 underline-offset-2 hover:underline dark:bg-slate-800 dark:text-brand-300"
                              >
                                {toolLabel(citation.tool)} · {id.slice(0, 8)}
                              </button>
                            </li>
                          )),
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {error && (
            <div className="pt-2">
              <Alert variant="error">{error}</Alert>
            </div>
          )}

          <form className="flex gap-2 pt-3" onSubmit={send}>
            <input
              aria-label="Mensaje"
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Escribe tu pregunta…"
              disabled={streaming}
            />
            <Button type="submit" loading={streaming}>
              Enviar
            </Button>
          </form>
        </div>
      </Card>
    </div>
  )
}
