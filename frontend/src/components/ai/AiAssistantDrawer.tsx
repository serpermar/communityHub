import { useEffect, useState } from 'react'
import { Button, Card, Input, Modal, Spinner } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useCommunity } from '@/context/CommunityContext'
import { deleteSession, listMessages, listSessions, streamChat } from '@/features/assistant/api'
import type { ChatCitation, ChatEvent } from '@/features/assistant/types'

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
    <div className="mt-2 space-y-1">
      {citations.map((citation, index) => (
        <div key={index} className="text-xs text-slate-500 dark:text-slate-400">
          <span className="font-medium">{toolLabel(citation.tool)}:</span>{' '}
          <span className="font-mono">{citation.ids.join(', ')}</span>
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
                        toolCalls: [...(message.toolCalls ?? []), { name: event.name, args: event.args }],
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
      <div className="grid gap-3 md:grid-cols-[220px_1fr]">
        <Card className="hidden md:block">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Conversaciones</p>
            <Button size="sm" variant="ghost" onClick={() => setSessionId(undefined)}>
              Nueva
            </Button>
          </div>
          <div className="mt-2 space-y-1">
            {sessions.length === 0 && <p className="text-xs text-slate-400">Sin conversaciones</p>}
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center gap-1">
                <button
                  className={`flex-1 truncate rounded px-2 py-1 text-left text-sm ${sessionId === s.id ? 'bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}
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
        <div className="flex h-[60vh] flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto rounded-card border border-slate-200 p-3 dark:border-slate-800">
            {messages.length === 0 && !sending && (
              <p className="text-center text-sm text-slate-400">Pregunta lo que necesites sobre la comunidad.</p>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-card px-3 py-2 text-sm ${
                    message.role === 'user'
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  {message.role === 'assistant' && message.toolCalls.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {message.toolCalls.map((toolCall, index) => (
                        <div key={index} className="text-xs opacity-80">
                          <span className="font-medium">Herramienta:</span> {toolLabel(toolCall.name)}
                        </div>
                      ))}
                    </div>
                  )}
                  {message.role === 'assistant' && renderCitations(message.citations)}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-card bg-slate-100 px-3 py-2 dark:bg-slate-800">
                  <Spinner />
                </div>
              </div>
            )}
            {error && <p className="text-sm text-danger-600">{error}</p>}
          </div>
          <form
            className="mt-2 flex gap-2"
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
