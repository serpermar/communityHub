import { useEffect, useState } from 'react'
import { useCommunity } from '@/context/CommunityContext'
import { AiAssistantDrawer } from './AiAssistantDrawer'

export function AiFloatingButton() {
  const { active } = useCommunity()
  const [open, setOpen] = useState(false)
  const [initialMessage, setInitialMessage] = useState<string | null>(null)

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ initialMessage?: string }>
      setInitialMessage(custom.detail?.initialMessage ?? null)
      setOpen(true)
    }
    window.addEventListener('open-ai-assistant', handler)
    return () => window.removeEventListener('open-ai-assistant', handler)
  }, [])

  if (!active) return null

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setInitialMessage(null)
          setOpen(true)
        }}
        className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
        aria-label="Abrir asistente IA"
        title="Preguntar a IA"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5 fill-none stroke-current"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M9 9h.01M15 9h.01M9 13h6" />
        </svg>
      </button>
      <AiAssistantDrawer
        open={open}
        onClose={() => {
          setOpen(false)
          setInitialMessage(null)
        }}
        initialMessage={initialMessage}
      />
    </>
  )
}

export function openAiAssistant(initialMessage?: string) {
  const event = new CustomEvent('open-ai-assistant', { detail: { initialMessage } })
  window.dispatchEvent(event)
}
