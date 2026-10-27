import { useEffect, useRef, useState } from 'react'
import styles from './AnimatedBackground.module.css'

type Variant = 'blobs' | 'mesh' | 'grid' | 'all'

/** Desplazamiento máximo del parallax, en píxeles. */
const MAX_OFFSET = 24
/** Factor de suavizado del lerp (0 = nunca llega, 1 = instantáneo). */
const EASE = 0.08

function parallaxStyle(depth: number): React.CSSProperties {
  return { '--depth': depth } as React.CSSProperties
}

export function AnimatedBackground({
  variant = 'all',
  interactive = true,
  showPauseButton = true,
}: {
  variant?: Variant
  /** Activa el parallax con el cursor. Desactivado en `prefers-reduced-motion`. */
  interactive?: boolean
  /** Muestra el botón de pausa (WCAG 2.2.2). */
  showPauseButton?: boolean
}) {
  const [paused, setPaused] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const target = useRef({ x: 0, y: 0 })
  const current = useRef({ x: 0, y: 0 })
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!interactive || paused) return
    if (typeof window === 'undefined') return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return

    const el = containerRef.current
    if (!el) return

    const onMove = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      target.current = {
        x: (event.clientX - rect.left) / rect.width - 0.5,
        y: (event.clientY - rect.top) / rect.height - 0.5,
      }
    }

    const tick = () => {
      current.current.x += (target.current.x - current.current.x) * EASE
      current.current.y += (target.current.y - current.current.y) * EASE
      el.style.setProperty('--mx', `${(current.current.x * MAX_OFFSET).toFixed(2)}px`)
      el.style.setProperty('--my', `${(current.current.y * MAX_OFFSET).toFixed(2)}px`)
      rafRef.current = requestAnimationFrame(tick)
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      window.removeEventListener('pointermove', onMove)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      el.style.removeProperty('--mx')
      el.style.removeProperty('--my')
    }
  }, [interactive, paused])

  return (
    <>
      <div ref={containerRef} className={styles.container} data-paused={paused} aria-hidden="true">
        {(variant === 'blobs' || variant === 'all') && (
          <>
            <div className={styles.parallax} style={parallaxStyle(1.2)}>
              <div className={`${styles.blob} ${styles.blob1}`} />
            </div>
            <div className={styles.parallax} style={parallaxStyle(0.8)}>
              <div className={`${styles.blob} ${styles.blob2}`} />
            </div>
            <div className={styles.parallax} style={parallaxStyle(1.6)}>
              <div className={`${styles.blob} ${styles.blob3}`} />
            </div>
          </>
        )}

        {(variant === 'mesh' || variant === 'all') && (
          <div className={styles.parallax} style={parallaxStyle(0.4)}>
            <div className={styles.mesh} />
          </div>
        )}

        {(variant === 'grid' || variant === 'all') && (
          <div className={styles.parallax} style={parallaxStyle(0.6)}>
            <div className={styles.grid} />
          </div>
        )}
      </div>

      {showPauseButton && (
        <button
          type="button"
          onClick={() => setPaused((value) => !value)}
          aria-pressed={paused}
          aria-label={paused ? 'Reanudar animación de fondo' : 'Pausar animación de fondo'}
          title={paused ? 'Reanudar animación' : 'Pausar animación'}
          className={styles.pauseButton}
        >
          {paused ? (
            <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.pauseIcon}>
              <path d="M8 5v14l11-7z" fill="currentColor" />
            </svg>
          ) : (
            <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.pauseIcon}>
              <rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor" />
              <rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" />
            </svg>
          )}
        </button>
      )}
    </>
  )
}
