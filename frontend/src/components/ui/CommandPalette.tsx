import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { NAV_ICONS } from '@/components/brand/NavIcons'
import { t } from '@/i18n'
import { visibleNavItems } from '@/routes/navItems'
import { prefetchRoute } from '@/routes/prefetch'
import type { MemberRole } from '@/types/roles'
import { cn } from '@/utils/cn'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { listIncidents } from '@/features/incidents/api'
import { listDocuments } from '@/features/documents/api'
import { listAnnouncements } from '@/features/announcements/api'
import { listMembers } from '@/features/members/api'
import type { Incident } from '@/features/incidents/types'
import type { CommunityDocument } from '@/features/documents/types'
import type { Announcement } from '@/features/announcements/types'
import type { Member } from '@/features/members/types'

type CommandItem =
  | { type: 'nav'; segment: string; label: string }
  | { type: 'incident'; id: string; title: string; subtitle: string }
  | { type: 'document'; id: string; title: string; subtitle: string }
  | { type: 'announcement'; id: string; title: string; subtitle: string }
  | { type: 'member'; id: string; title: string; subtitle: string }

/**
 * Selector de comandos (Cmd/Ctrl+K): salta a cualquier seccion de la comunidad
 * activa filtrando por texto. Reutiliza `visibleNavItems` (mismos destinos y
 * permisos que el sidebar) y ahora también busca entidades reales.
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

  const debouncedQuery = useDebouncedValue(query, 300)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [documents, setDocuments] = useState<CommunityDocument[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [loadingEntities, setLoadingEntities] = useState(false)

  const items = useMemo(() => visibleNavItems(role), [role])
  const navItems = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const withLabels = items.map((item) => ({ item, label: t(item.labelKey) }))
    if (!needle) return withLabels
    return withLabels.filter(({ label }) => label.toLowerCase().includes(needle))
  }, [items, query])

  useEffect(() => {
    if (!open || !communityId) {
      setIncidents([])
      setDocuments([])
      setAnnouncements([])
      setMembers([])
      return
    }
    const needle = debouncedQuery.trim()
    if (needle.length < 2) {
      setIncidents([])
      setDocuments([])
      setAnnouncements([])
      setMembers([])
      return
    }
    setLoadingEntities(true)
    Promise.allSettled([
      listIncidents(communityId, { q: needle, page: 1, limit: 5 }),
      listDocuments(communityId, { q: needle, page: 1, limit: 5 }),
      listAnnouncements(communityId, { q: needle, page: 1, limit: 5 }),
      listMembers(communityId),
    ])
      .then(([incRes, docRes, annRes, memRes]) => {
        if (incRes.status === 'fulfilled') setIncidents(incRes.value.data)
        if (docRes.status === 'fulfilled') setDocuments(docRes.value.data)
        if (annRes.status === 'fulfilled') setAnnouncements(annRes.value.data)
        if (memRes.status === 'fulfilled') {
          const lower = needle.toLowerCase()
          setMembers(
            memRes.value
              .filter((m) => (m.fullName?.toLowerCase().includes(lower) ?? false) || (m.email?.toLowerCase().includes(lower) ?? false))
              .slice(0, 5),
          )
        }
      })
      .finally(() => setLoadingEntities(false))
  }, [open, communityId, debouncedQuery])

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

  const allItems = useMemo<CommandItem[]>(() => {
    const result: CommandItem[] = []
    for (const { item, label } of navItems) {
      result.push({ type: 'nav', segment: item.segment, label })
    }
    for (const incident of incidents) {
      result.push({
        type: 'incident',
        id: incident.id,
        title: incident.title,
        subtitle: `${incident.referenceCode} · ${incident.status}`,
      })
    }
    for (const doc of documents) {
      result.push({ type: 'document', id: doc.id, title: doc.title, subtitle: doc.category })
    }
    for (const ann of announcements) {
      result.push({ type: 'announcement', id: ann.id, title: ann.title, subtitle: ann.type })
    }
    for (const member of members) {
      const title = member.fullName || member.email || ''
      result.push({ type: 'member', id: member.id, title, subtitle: member.email || '' })
    }
    return result
  }, [navItems, incidents, documents, announcements, members])

  // Precarga el chunk de la opcion resaltada, para que Enter navegue sin espera.
  useEffect(() => {
    const item = allItems[highlight]
    if (item && item.type === 'nav') prefetchRoute(item.segment)
  }, [allItems, highlight])

  if (!open) return null

  const close = () => {
    onOpenChange(false)
    restoreRef.current?.focus?.()
  }

  const choose = (item: CommandItem) => {
    close()
    if (item.type === 'nav') {
      navigate(`/c/${communityId}/${item.segment}`)
      return
    }
    if (item.type === 'incident') {
      navigate(`/c/${communityId}/incidents/${item.id}`)
      return
    }
    if (item.type === 'document') {
      navigate(`/c/${communityId}/documents`)
      return
    }
    if (item.type === 'announcement') {
      navigate(`/c/${communityId}/announcements`)
      return
    }
    if (item.type === 'member') {
      navigate(`/c/${communityId}/members`)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((value) => Math.min(value + 1, allItems.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((value) => Math.max(value - 1, 0))
    } else if (event.key === 'Enter' && allItems[highlight]) {
      event.preventDefault()
      choose(allItems[highlight])
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
            allItems[highlight] && allItems[highlight].type === 'nav'
              ? `command-option-${(allItems[highlight] as { segment: string }).segment}`
              : undefined
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
          {allItems.length === 0 ? (
            <li className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
              {query.trim().length >= 2 && loadingEntities ? 'Buscando...' : t('app.commandNoResults')}
            </li>
          ) : (
            allItems.map((item, index) => {
              if (item.type === 'nav') {
                const Icon = NAV_ICONS[item.segment]
                return (
                  <li key={`nav-${item.segment}`}>
                    <button
                      type="button"
                      id={`command-option-${item.segment}`}
                      role="option"
                      aria-selected={index === highlight}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => choose(item)}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-slate-700 dark:text-slate-200',
                        index === highlight && 'bg-slate-100 dark:bg-slate-800',
                      )}
                    >
                      {Icon && <Icon aria-hidden="true" />}
                      {item.label}
                    </button>
                  </li>
                )
              }
              return (
                <li key={`${item.type}-${item.id}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === highlight}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => choose(item)}
                    className={cn(
                      'flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left text-sm text-slate-700 dark:text-slate-200',
                      index === highlight && 'bg-slate-100 dark:bg-slate-800',
                    )}
                  >
                    <span className="font-medium">{item.title}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{item.subtitle}</span>
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
