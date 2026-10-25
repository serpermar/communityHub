import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cn } from '@/utils/cn'
import type { BadgeTone } from './status'

export function Badge({
  children,
  tone = 'slate',
  className,
}: {
  children: ReactNode
  tone?: BadgeTone
  className?: string
}) {
  const tones: Record<BadgeTone, string> = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
    green: 'bg-success-100 text-success-800 dark:bg-success-950 dark:text-success-100',
    amber: 'bg-warning-100 text-warning-800 dark:bg-warning-950 dark:text-warning-100',
    red: 'bg-danger-100 text-danger-800 dark:bg-danger-950 dark:text-danger-100',
    blue: 'bg-info-100 text-info-800 dark:bg-info-950 dark:text-info-100',
    violet: 'bg-accent-100 text-accent-800 dark:bg-accent-950 dark:text-accent-100',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'rounded-card border border-slate-200 bg-surface shadow-card transition-shadow duration-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900',
        className,
      )}
    >
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          {typeof title === 'string' ? (
            <h2 className="text-section-title text-slate-800 dark:text-slate-100">{title}</h2>
          ) : (
            title
          )}
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const previouslyFocused = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    const focusables = () =>
      dialog
        ? Array.from(
            dialog.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
            ),
          )
        : []

    const first = focusables()[0] ?? dialog
    first?.focus()

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === firstItem || active === dialog)) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault()
        firstItem.focus()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 motion-safe:animate-fade-in" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative z-10 w-full max-w-lg rounded-overlay bg-surface shadow-overlay outline-none motion-safe:animate-scale-in dark:bg-slate-900"
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <h2 id={titleId} className="text-section-title text-slate-800 dark:text-slate-100">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded px-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          >
            ✕
          </button>
        </header>
        <div className="px-4 py-4">{children}</div>
        {footer && (
          <footer className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
