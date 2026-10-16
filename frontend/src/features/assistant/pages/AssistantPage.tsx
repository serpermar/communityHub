import { useState } from 'react'
import { Alert, Button, Card, Spinner } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { deleteSession, listMessages, listSessions, streamChat } from '../api'
import type { ChatMessage } from '../types'

interface RenderedMessage {
  id: string
  role: string
  content: string
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
        result.data.map((message: ChatMessage) => ({
          id: message.id,
          role: message.role,
          content: message.content,
        })),
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
    const userMessage: RenderedMessage = { id: `u-${Date.now()}`, role: 'user', content: text }
    const assistantId = `a-${Date.now()}`
    setMessages((current) => [
      ...current,
      userMessage,
      { id: assistantId, role: 'assistant', content: '' },
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
                    sessionId === session.id ? 'bg-brand-50 text-brand-700' : 'hover:bg-slate-100'
                  }`}
                >
                  {session.title ?? 'Conversación'}
                </button>
                <button
                  type="button"
                  aria-label="Eliminar conversación"
                  className="text-xs text-slate-400 hover:text-red-600"
                  onClick={() => void removeSession(session.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">Sin conversaciones.</p>
        )}
      </Card>

      <Card title="Asistente">
        <div className="flex h-[28rem] flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            {messages.length === 0 ? (
              <p className="text-sm text-slate-500">
                Pregunta sobre incidencias, reservas, avisos o votaciones de la comunidad.
              </p>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    message.role === 'user'
                      ? 'ml-auto bg-brand-600 text-white'
                      : 'bg-slate-100 text-slate-800'
                  }`}
                >
                  {message.content || <span className="text-slate-400">…</span>}
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
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
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
