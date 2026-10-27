import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { NAV_ICONS } from '@/components/brand/NavIcons'
import { t } from '@/i18n'
import { visibleNavItems } from '@/routes/navItems'
import { prefetchRoute } from '@/routes/prefetch'
import type { MemberRole } from '@/types/roles'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { listIncidents } from '@/features/incidents/api'
import { listDocuments } from '@/features/documents/api'
import { listAnnouncements } from '@/features/announcements/api'
import { listMembers } from '@/features/members/api'
import type { Incident } from '@/features/incidents/types'
import type { CommunityDocument } from '@/features/documents/types'
import type { Announcement } from '@/features/announcements/types'
import type { Member } from '@/features/members/types'
import styles from './CommandPalette.module.css'

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
              .filter(
                (m) =>
                  (m.fullName?.toLowerCase().includes(lower) ?? false) ||
                  (m.email?.toLowerCase().includes(lower) ?? false),
              )
              .slice(0, 5),
          )
        }
      })
      .finally(() => setLoadingEntities(false))
  }, [open, communityId, debouncedQuery])

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
    <div className={styles.overlay}>
      <div className={styles.backdrop} onClick={close} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('app.commandPalette')}
        className={styles.dialog}
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
          className={styles.input}
        />
        <ul
          id="command-listbox"
          role="listbox"
          aria-label={t('app.commandPalette')}
          className={styles.list}
        >
          {allItems.length === 0 ? (
            <li className={styles.emptyItem}>
              {query.trim().length >= 2 && loadingEntities
                ? 'Buscando...'
                : t('app.commandNoResults')}
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
                      className={`${styles.navOption} ${index === highlight ? styles.optionHighlighted : ''}`}
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
                    className={`${styles.entityOption} ${index === highlight ? styles.optionHighlighted : ''}`}
                  >
                    <span className={styles.entityTitle}>{item.title}</span>
                    <span className={styles.entitySubtitle}>{item.subtitle}</span>
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
