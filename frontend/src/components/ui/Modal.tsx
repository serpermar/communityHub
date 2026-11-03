import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)

  // Cerrar con Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Bloquear scroll del body
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // Gestión de foco: guardar el que tenía foco antes y enfocar el primer input
  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    const firstInput = contentRef.current?.querySelector<HTMLElement>(
      'input:not([type="hidden"]), textarea, select',
    )
    const fallback = contentRef.current?.querySelector<HTMLElement>(
      'button, [href], [tabindex]:not([tabindex="-1"])',
    )
    ;(firstInput ?? fallback)?.focus()
    return () => {
      previouslyFocused.current?.focus?.()
    }
  }, [open])

  return createPortal(
    <AnimatePresence>
      {open && (
        // ⬇️ motion.div CON key: esto es lo que rompe el ciclo de remontaje
        <motion.div
          key="modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          // Cierra solo si el mousedown fue en el overlay mismo, no en el contenido
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose()
          }}
        >
          {/* Backdrop visual: ya no gestiona clics por sí mismo */}
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" aria-hidden="true" />

          {/* Contenido: bloquea mousedown/click para que no lleguen al overlay */}
          <motion.div
            ref={contentRef}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', duration: 0.3, bounce: 0.2 }}
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-900"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>

            <div className="px-6 py-4">{children}</div>

            {footer && (
              <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
