import { useCallback, useEffect, useRef, useState } from 'react'

const SIDEBAR_KEY = 'communityhub.sidebar'

function readInitialCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(SIDEBAR_KEY) === 'collapsed'
}

interface UseAppLayoutOptions {
  activeId?: string
}

export function useAppLayout({ activeId }: UseAppLayoutOptions = {}) {
  const [collapsed, setCollapsed] = useState<boolean>(readInitialCollapsed)
  const [menuOpen, setMenuOpen] = useState<boolean>(false)
  const [paletteOpen, setPaletteOpen] = useState<boolean>(false)

  // ⬇️ sin `| null` en el genérico: el tipo que devuelve encaja con `ref`
  const desktopSidebarRef = useRef<HTMLElement>(null)
  const mobileSidebarRef = useRef<HTMLElement>(null)
  const mobileTriggerRef = useRef<HTMLButtonElement>(null)

  // Persistir el estado del sidebar
  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'expanded')
  }, [collapsed])

  // Cerrar el menú móvil al cambiar de comunidad
  useEffect(() => {
    setMenuOpen(false)
  }, [activeId])

  // Ctrl/Cmd+B para colapsar (ignora inputs/textarea/select)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isEditable =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable === true
      if (isEditable) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        setCollapsed((value) => !value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Menú móvil: Esc + bloqueo de scroll + focus trap
  useEffect(() => {
    if (!menuOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        mobileTriggerRef.current?.focus()
        return
      }
      if (event.key !== 'Tab' || !mobileSidebarRef.current) return

      const focusables = mobileSidebarRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    const timer = window.setTimeout(() => {
      mobileSidebarRef.current
        ?.querySelector<HTMLElement>('a[href], button:not([disabled])')
        ?.focus()
    }, 0)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKey)
      window.clearTimeout(timer)
    }
  }, [menuOpen])

  const toggleCollapsed = useCallback(() => setCollapsed((value) => !value), [])
  const openMenu = useCallback(() => setMenuOpen(true), [])
  const closeMenu = useCallback(() => {
    setMenuOpen(false)
    mobileTriggerRef.current?.focus()
  }, [])

  return {
    collapsed,
    menuOpen,
    paletteOpen,
    desktopSidebarRef,
    mobileSidebarRef,
    mobileTriggerRef,
    setPaletteOpen,
    setMenuOpen,
    toggleCollapsed,
    openMenu,
    closeMenu,
  }
}
