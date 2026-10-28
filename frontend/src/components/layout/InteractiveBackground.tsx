import { useEffect, useRef } from 'react'
import styles from './InteractiveBackground.module.css'

/** Desplazamiento máximo del parallax, en píxeles. */
const MAX_OFFSET = 28
/** Factor de suavizado del lerp (0 = nunca llega, 1 = instantáneo). */
const EASE = 0.08

export function InteractiveBackground() {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const target = useRef({ x: 0, y: 0 })
  const current = useRef({ x: 0, y: 0 })
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
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
  }, [])

  return (
    <div ref={wrapperRef} className={styles.wrapper}>
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
    </div>
  )
}
