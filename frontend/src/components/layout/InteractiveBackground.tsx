import { useEffect, useRef, useState } from 'react'
import { t } from '@/i18n'
import styles from './InteractiveBackground.module.css'

/** Desplazamiento máximo del parallax, en píxeles. */
const MAX_OFFSET = 28
/** Factor de suavizado del lerp (0 = nunca llega, 1 = instantáneo). */
const EASE = 0.08

export function InteractiveBackground() {
  const [paused, setPaused] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const target = useRef({ x: 0, y: 0 })
  const current = useRef({ x: 0, y: 0 })
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (paused) return
    if (typeof window === 'undefined') return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return

    const el = wrapperRef.current
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
      el.style.setProperty('--mx', (current.current.x * MAX_OFFSET).toFixed(2) + 'px')
      el.style.setProperty('--my', (current.current.y * MAX_OFFSET).toFixed(2) + 'px')
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
  }, [paused])

  return (
    <div ref={wrapperRef} className={styles.wrapper} data-paused={paused}>
      <div className={styles.blobs} aria-hidden="true">
        <div className={`${styles.blobOuter} ${styles.blob1}`}>
          <div className={styles.blobInner} />
        </div>
        <div className={`${styles.blobOuter} ${styles.blob2}`}>
          <div className={styles.blobInner} />
        </div>
        <div className={`${styles.blobOuter} ${styles.blob3}`}>
          <div className={styles.blobInner} />
        </div>
      </div>

      <button
        type="button"
        onClick={() => setPaused((value) => !value)}
        aria-pressed={paused}
        aria-label={paused ? t('app.resumeBackground') : t('app.pauseBackground')}
        title={paused ? t('app.resumeBackground') : t('app.pauseBackground')}
        className={styles.toggle}
      >
        {paused ? (
          <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.toggleIcon}>
            <path d="M8 5v14l11-7z" fill="currentColor" />
          </svg>
        ) : (
          <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.toggleIcon}>
            <rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor" />
            <rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" />
          </svg>
        )}
      </button>
    </div>
  )
}
