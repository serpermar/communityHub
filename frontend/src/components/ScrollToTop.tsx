import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/** Vuelve al inicio del documento al cambiar de ruta (FE-19). */
export function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [pathname])

  return null
}
