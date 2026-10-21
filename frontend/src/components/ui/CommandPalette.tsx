import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { NAV_ICONS } from '@/components/brand/NavIcons'
import { t } from '@/i18n'
import { visibleNavItems } from '@/routes/navItems'
import { prefetchRoute } from '@/routes/prefetch'
import type { MemberRole } from '@/types/roles'
import { cn } from '@/utils/cn'

/**
 * Selector de comandos (Cmd/Ctrl+K): salta a cualquier seccion de la comunidad
 * activa filtrando por texto. Reutiliza `visibleNavItems` (mismos destinos y
 * permisos que el sidebar) y respeta el foco/Escape como el `Modal`.
 *
 * Es controlado (`open`/`onClose`); el atajo global vive aqui y avisa al padre
 * con `onOpenChange` para que la cabecera tambien pueda abrirlo.
 */
export function CommandPalette({
  communityId,
  role,
  open,
  onOpenChange,
}: {
  communityId: string
  role: MemberRole | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  const items = useMemo(() => visibleNavItems(role), [role])
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const withLabels = items.map((item) => ({ item, label: t(item.labelKey) }))
    if (!needle) return withLabels
    return withLabels.filter(({ label }) => label.toLowerCase().includes(needle))
  }, [items, query])

  // Atajo global Cmd/Ctrl+K.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onOpenChange(!open)
      } else if (event.key === 'Escape') {
        onOpenChange(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  // Al abrir: guarda el foco previo, enfoca el input y resetea la busqueda.
  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement as HTMLElement | null
    setQuery('')
    setHighlight(0)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    setHighlight(0)
  }, [query])

  // Precarga el chunk de la opcion resaltada, para que Enter navegue sin espera.
  useEffect(() => {
    const item = filtered[highlight]
    if (item) prefetchRoute(item.item.segment)
  }, [filtered, highlight])

  if (!open) return null

  const close = () => {
    onOpenChange(false)
    restoreRef.current?.focus?.()
  }

  const choose = (segment: string) => {
    close()
    navigate(`/c/${communityId}/${segment}`)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((value) => Math.min(value + 1, filtered.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((value) => Math.max(value - 1, 0))
    } else if (event.key === 'Enter' && filtered[highlight]) {
      event.preventDefault()
      choose(filtered[highlight].item.segment)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[15vh]">
      <div className="absolute inset-0 bg-slate-900/40" onClick={close} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('app.commandPalette')}
        className="relative z-10 w-full max-w-lg overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-listbox"
          aria-autocomplete="list"
          aria-label={t('app.commandPalette')}
          aria-activedescendant={
            filtered[highlight] ? `command-option-${filtered[highlight].item.segment}` : undefined
          }
          placeholder={t('app.commandPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          className="w-full border-b border-slate-200 bg-transparent px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none dark:border-slate-700 dark:text-slate-100"
        />
        <ul
          id="command-listbox"
          role="listbox"
          aria-label={t('app.commandPalette')}
          className="max-h-72 overflow-y-auto py-1"
        >
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
              {t('app.commandNoResults')}
            </li>
          ) : (
            filtered.map(({ item, label }, index) => {
              const Icon = NAV_ICONS[item.segment]
              return (
                <li key={item.segment}>
                  <button
                    type="button"
                    id={`command-option-${item.segment}`}
                    role="option"
                    aria-selected={index === highlight}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => choose(item.segment)}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-slate-700 dark:text-slate-200',
                      index === highlight && 'bg-slate-100 dark:bg-slate-800',
                    )}
                  >
                    {Icon && <Icon aria-hidden="true" />}
                    {label}
                  </button>
                </li>
              )
            })
          )}
        </ul>
      </div>
    </div>
  )
}
