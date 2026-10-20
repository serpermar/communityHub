import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '@/i18n'
import { cn } from '@/utils/cn'
import type { CommunitySummary } from '@/types/community'

/**
 * Selector de comunidad con búsqueda. Con muchas comunidades, un `<select>`
 * nativo se vuelve incómodo; esto es un combobox accesible (input + lista) que
 * filtra por nombre. Se cierra al elegir, con Escape o al pulsar fuera.
 */
export function CommunitySwitcher({
  communities,
  activeId,
}: {
  communities: CommunitySummary[]
  activeId: string
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const active = communities.find((community) => community.id === activeId)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return communities
    return communities.filter((community) => community.name.toLowerCase().includes(needle))
  }, [communities, query])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onPointer)
    return () => window.removeEventListener('mousedown', onPointer)
  }, [open])

  useEffect(() => {
    setHighlight(0)
  }, [query, open])

  const choose = (id: string) => {
    setOpen(false)
    setQuery('')
    navigate(`/c/${id}/dashboard`)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!open) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((value) => Math.min(value + 1, filtered.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((value) => Math.max(value - 1, 0))
    } else if (event.key === 'Enter' && filtered[highlight]) {
      event.preventDefault()
      choose(filtered[highlight].id)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls="community-listbox"
        aria-autocomplete="list"
        aria-label={t('app.switchCommunity')}
        value={open ? query : (active?.name ?? '')}
        placeholder={t('app.searchCommunity')}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
        className="w-32 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm sm:w-48 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
      />
      {open && (
        <ul
          id="community-listbox"
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-56 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-800"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-slate-500 dark:text-slate-400">
              {t('app.noCommunityResults')}
            </li>
          ) : (
            filtered.map((community, index) => (
              <li key={community.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={community.id === activeId}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => choose(community.id)}
                  className={cn(
                    'block w-full px-3 py-2 text-left',
                    index === highlight
                      ? 'bg-slate-100 dark:bg-slate-700'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-700/50',
                    community.id === activeId && 'font-medium text-brand-700 dark:text-brand-300',
                  )}
                >
                  {community.name}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
