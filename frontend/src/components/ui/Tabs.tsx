import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { t } from '@/i18n'
import { cn } from '@/utils/cn'

export interface TabItem<T extends string> {
  value: T
  label: ReactNode
}

/**
 * Pestañas accesibles (patrón ARIA tabs) sobre botones. La navegacion con
 * flechas mueve el foco (roving tabindex) y selecciona al instante; `Inicio`/`Fin`
 * saltan a los extremos. El estado lo controla quien usa el componente, de modo
 * que la pestaña activa se pueda persistir en la URL.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  items: TabItem<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel?: string
  className?: string
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  const focusAndSelect = (index: number) => {
    const item = items[index]
    if (!item) return
    onChange(item.value)
    refs.current[item.value]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      focusAndSelect((index + 1) % items.length)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusAndSelect((index - 1 + items.length) % items.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusAndSelect(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusAndSelect(items.length - 1)
    }
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel ?? t('app.tabs')}
      className={cn('flex gap-2', className)}
    >
      {items.map((item, index) => {
        const selected = item.value === value
        return (
          <button
            key={item.value}
            ref={(node) => {
              refs.current[item.value] = node
            }}
            type="button"
            role="tab"
            id={`tab-${item.value}`}
            aria-selected={selected}
            aria-controls={`tabpanel-${item.value}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              selected
                ? 'bg-brand-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
            )}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

/** Panel asociado a una pestaña de `Tabs`. */
export function TabPanel({
  value,
  active,
  children,
}: {
  value: string
  active: string
  children: ReactNode
}) {
  if (value !== active) return null
  return (
    <div role="tabpanel" id={`tabpanel-${value}`} aria-labelledby={`tab-${value}`} tabIndex={0}>
      {children}
    </div>
  )
}
