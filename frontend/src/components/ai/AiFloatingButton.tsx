import { useEffect, useState } from 'react'
import { useCommunity } from '@/context/CommunityContext'
import { AiAssistantDrawer } from './AiAssistantDrawer'
import styles from './AiFloatingButton.module.css'

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
        className={styles.button}
        aria-label="Abrir asistente IA"
        title="Preguntar a IA"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={styles.icon}
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
