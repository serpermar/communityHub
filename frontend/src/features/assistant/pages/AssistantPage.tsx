import { useState } from 'react'
import { Alert, Button, Card, Spinner } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { deleteSession, listMessages, listSessions, streamChat } from '../api'
import type { ChatCitation, ChatMessage, ChatToolCall } from '../types'
import styles from './AssistantPage.module.css'

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
    <div className={styles.page}>
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
          <ul className={styles.sessionList}>
            {sessions.data.data.map((session) => (
              <li key={session.id} className={styles.sessionRow}>
                <button
                  type="button"
                  onClick={() => void openSession(session.id)}
                  className={`${styles.sessionButton} ${
                    sessionId === session.id ? styles.sessionButtonActive : ''
                  }`}
                >
                  {session.title ?? 'Conversación'}
                </button>
                <button
                  type="button"
                  aria-label="Eliminar conversación"
                  className={styles.deleteButton}
                  onClick={() => void removeSession(session.id)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.emptySessions}>Sin conversaciones.</p>
        )}
      </Card>

      <Card title="Asistente">
        <div className={styles.chatContainer}>
          <div className={styles.messagesArea}>
            {messages.length === 0 ? (
              <p className={styles.emptyChat}>
                Pregunta sobre incidencias, reservas, avisos o votaciones de la comunidad.
              </p>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`${styles.messageBubble} ${
                    message.role === 'user'
                      ? styles.messageBubbleUser
                      : styles.messageBubbleAssistant
                  }`}
                >
                  {message.content || <span className={styles.messagePlaceholder}>…</span>}

                  {message.role !== 'user' && message.toolCalls.length > 0 && (
                    <ul className={styles.toolList}>
                      {message.toolCalls.map((call, index) => (
                        <li key={`${call.name}-${index}`} className={styles.toolChip}>
                          🔧 {toolLabel(call.name)}
                        </li>
                      ))}
                    </ul>
                  )}

                  {message.role !== 'user' && message.citations.length > 0 && (
                    <div className={styles.citations}>
                      <span className={styles.citationsLabel}>Fuentes</span>
                      <ul className={styles.citationList}>
                        {message.citations.flatMap((citation, ci) =>
                          citation.ids.map((id) => (
                            <li key={`${citation.tool}-${ci}-${id}`}>
                              <button
                                type="button"
                                onClick={() =>
                                  active &&
                                  window.open(citationLink(active.id, citation, id), '_self')
                                }
                                className={styles.citationButton}
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
            <div className={styles.errorWrapper}>
              <Alert variant="error">{error}</Alert>
            </div>
          )}

          <form className={styles.form} onSubmit={send}>
            <input
              aria-label="Mensaje"
              className={styles.input}
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
