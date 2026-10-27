import { useEffect, useState } from 'react'
import { Button, Card, Input, Modal, Spinner } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useCommunity } from '@/context/CommunityContext'
import { deleteSession, listMessages, listSessions, streamChat } from '@/features/assistant/api'
import type { ChatCitation, ChatEvent } from '@/features/assistant/types'
import styles from './AiAssistantDrawer.module.css'

interface RenderedMessage {
  id: string
  role: string
  content: string
  toolCalls: Array<{ name: string; args: unknown }>
  citations: ChatCitation[]
}

function ensureTrace(message: RenderedMessage): RenderedMessage {
  return {
    ...message,
    toolCalls: message.toolCalls ?? [],
    citations: message.citations ?? [],
  }
}

function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    list_incidents: 'Consultar incidencias',
    get_incident: 'Leer una incidencia',
    list_announcements: 'Consultar avisos',
    list_documents: 'Consultar documentos',
    list_reservations: 'Consultar reservas',
    list_common_areas: 'Consultar zonas comunes',
    list_members: 'Consultar miembros',
    get_me: 'Consultar mi perfil',
    list_votes: 'Consultar votaciones',
    get_vote: 'Leer una votación',
    classify_incident: 'Clasificar incidencia',
    create_incident_draft: 'Crear borrador de incidencia',
    create_announcement_draft: 'Crear borrador de aviso',
  }
  return labels[name] ?? name
}

function renderCitations(citations: ChatCitation[] | undefined) {
  if (!citations || citations.length === 0) return null
  return (
    <div className={styles.citationContainer}>
      {citations.map((citation, index) => (
        <div key={index} className={styles.citationItem}>
          <span className={styles.traceItemBold}>{toolLabel(citation.tool)}:</span>{' '}
          <span className={styles.citationIds}>{citation.ids.join(', ')}</span>
        </div>
      ))}
    </div>
  )
}

export function AiAssistantDrawer({
  open,
  onClose,
  initialMessage,
}: {
  open: boolean
  onClose: () => void
  initialMessage?: string | null
}) {
  const { active } = useCommunity()
  const [sessions, setSessions] = useState<Array<{ id: string; title: string | null }>>([])
  const [sessionId, setSessionId] = useState<string | undefined>(undefined)
  const [messages, setMessages] = useState<RenderedMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !active) return
    listSessions()
      .then((result) => setSessions(result.data.map((s) => ({ id: s.id, title: s.title }))))
      .catch(() => undefined)
  }, [open, active])

  useEffect(() => {
    if (!open || !sessionId) {
      setMessages([])
      return
    }
    listMessages(sessionId)
      .then((result) => {
        setMessages(
          result.data
            .map((message) =>
              ensureTrace({
                id: message.id,
                role: message.role,
                content: message.content,
                toolCalls: message.toolCalls ?? [],
                citations: message.citations ?? [],
              }),
            )
            .reverse(),
        )
      })
      .catch(() => undefined)
  }, [open, sessionId])

  useEffect(() => {
    if (!open || !initialMessage || sending) return
    setInput(initialMessage)
  }, [open, initialMessage, sending])

  const send = async (text: string) => {
    if (!active || !text.trim() || sending) return
    setSending(true)
    setError(null)

    const userMessage: RenderedMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      toolCalls: [],
      citations: [],
    }
    setMessages((prev) => [...prev, userMessage])
    setInput('')

    const assistantMessageId = `assistant-${Date.now()}`
    const assistantMessage: RenderedMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      toolCalls: [],
      citations: [],
    }
    setMessages((prev) => [...prev, assistantMessage])

    try {
      await streamChat(
        {
          message: text.trim(),
          sessionId,
          communityId: active.id,
        },
        {
          onEvent: (event: ChatEvent) => {
            if (event.type === 'meta') {
              if (!sessionId) {
                setSessionId(event.sessionId)
                setSessions((prev) => {
                  if (prev.some((s) => s.id === event.sessionId)) return prev
                  return [{ id: event.sessionId, title: text.trim().slice(0, 60) }, ...prev]
                })
              }
              return
            }
            if (event.type === 'tool_call') {
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === assistantMessageId
                    ? {
                        ...message,
                        toolCalls: [
                          ...(message.toolCalls ?? []),
                          { name: event.name, args: event.args },
                        ],
                      }
                    : message,
                ),
              )
              return
            }
            if (event.type === 'citation') {
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === assistantMessageId
                    ? { ...message, citations: [...(message.citations ?? []), event] }
                    : message,
                ),
              )
              return
            }
            if (event.type === 'token') {
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === assistantMessageId
                    ? { ...message, content: message.content + event.delta }
                    : message,
                ),
              )
              return
            }
            if (event.type === 'done') {
              return
            }
            if (event.type === 'error') {
              setError(event.message)
            }
          },
        },
      )
    } catch (caught) {
      setError(ApiError.from(caught).message)
    } finally {
      setSending(false)
    }
  }

  const handleDeleteSession = async (id: string) => {
    try {
      await deleteSession(id)
      setSessions((prev) => prev.filter((s) => s.id !== id))
      if (sessionId === id) {
        setSessionId(undefined)
        setMessages([])
      }
    } catch {
      // ignore
    }
  }

  return (
    <Modal open={open} title="Asistente IA" onClose={onClose}>
      <div className={styles.gridLayout}>
        <Card className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <p className={styles.sidebarTitle}>Conversaciones</p>
            <Button size="sm" variant="ghost" onClick={() => setSessionId(undefined)}>
              Nueva
            </Button>
          </div>
          <div className={styles.sessionList}>
            {sessions.length === 0 && <p className={styles.emptyText}>Sin conversaciones</p>}
            {sessions.map((s) => (
              <div key={s.id} className={styles.sessionRow}>
                <button
                  className={`${styles.sessionItem} ${sessionId === s.id ? styles.sessionItemActive : ''}`}
                  onClick={() => setSessionId(s.id)}
                >
                  {s.title || 'Sin título'}
                </button>
                <Button size="sm" variant="ghost" onClick={() => handleDeleteSession(s.id)}>
                  ×
                </Button>
              </div>
            ))}
          </div>
        </Card>

        <div className={styles.chatContainer}>
          <div className={styles.messagesArea}>
            {messages.length === 0 && !sending && (
              <p className={styles.emptyChat}>Pregunta lo que necesites sobre la comunidad.</p>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={`${styles.messageRow} ${
                  message.role === 'user' ? styles.messageRowUser : styles.messageRowAssistant
                }`}
              >
                <div
                  className={`${styles.messageBubble} ${
                    message.role === 'user'
                      ? styles.messageBubbleUser
                      : styles.messageBubbleAssistant
                  }`}
                >
                  <p className={styles.messageText}>{message.content}</p>

                  {message.role === 'assistant' && message.toolCalls.length > 0 && (
                    <div className={styles.traceContainer}>
                      {message.toolCalls.map((toolCall, index) => (
                        <div key={index} className={styles.traceItem}>
                          <span className={styles.traceItemBold}>Herramienta:</span>{' '}
                          {toolLabel(toolCall.name)}
                        </div>
                      ))}
                    </div>
                  )}
                  {message.role === 'assistant' && renderCitations(message.citations)}
                </div>
              </div>
            ))}
            {sending && (
              <div className={styles.loadingRow}>
                <div className={styles.loadingBubble}>
                  <Spinner />
                </div>
              </div>
            )}
            {error && <p className={styles.errorText}>{error}</p>}
          </div>
          <form
            className={styles.inputForm}
            onSubmit={(e) => {
              e.preventDefault()
              void send(input)
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribe tu pregunta..."
              disabled={sending}
            />
            <Button type="submit" loading={sending}>
              Enviar
            </Button>
          </form>
        </div>
      </div>
    </Modal>
  )
}
