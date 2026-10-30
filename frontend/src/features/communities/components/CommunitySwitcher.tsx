import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '@/i18n'
import { cn } from '@/utils/cn'
import type { CommunitySummary } from '@/types/community'
import styles from './CommunitySwitcher.module.css'

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

  const choose = (community: CommunitySummary) => {
    setOpen(false)
    setQuery('')
    // CAMBIO: Usamos community.slug
    navigate(`/c/${community.slug}/dashboard`)
  }

  const optionId = (id: string) => `community-option-${id}`

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
    } else if (event.key === 'Home') {
      event.preventDefault()
      setHighlight(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setHighlight(filtered.length - 1)
    } else if (event.key === 'Enter' && filtered[highlight]) {
      event.preventDefault()
      choose(filtered[highlight])
    }
  }

  return (
    <div ref={containerRef} className={styles.wrapper}>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls="community-listbox"
        aria-autocomplete="list"
        aria-label={t('app.switchCommunity')}
        aria-activedescendant={
          open && filtered[highlight] ? optionId(filtered[highlight].id) : undefined
        }
        value={open ? query : (active?.name ?? '')}
        placeholder={t('app.searchCommunity')}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
        className={styles.input}
      />
      {open && (
        <ul
          id="community-listbox"
          role="listbox"
          aria-label={t('app.switchCommunity')}
          className={styles.listbox}
        >
          {filtered.length === 0 ? (
            <li className={styles.emptyItem}>{t('app.noCommunityResults')}</li>
          ) : (
            filtered.map((community, index) => (
              <li key={community.id}>
                <button
                  type="button"
                  id={optionId(community.id)}
                  role="option"
                  aria-selected={index === highlight}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => choose(community)}
                  className={cn(
                    styles.optionButton,
                    index === highlight && styles.optionHighlighted,
                    community.id === activeId && styles.optionActive,
                  )}
                >
                  <span>{community.name}</span>
                  {community.id === activeId && (
                    <span aria-hidden="true" className={styles.checkmark}>
                      ✓
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
