import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './AuthTransition.module.css'

type Phase = 'fade' | 'zoom' | 'done'

export function AuthTransition({ trigger }: { trigger: boolean }) {
  const [phase, setPhase] = useState<Phase>('fade')
  const [active, setActive] = useState(false)

  useEffect(() => {
    if (!trigger) return
    setActive(true)
    setPhase('fade')
    const t1 = window.setTimeout(() => setPhase('zoom'), 200)
    const t2 = window.setTimeout(() => setPhase('done'), 900)
    const t3 = window.setTimeout(() => setActive(false), 1000)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
    }
  }, [trigger])

  if (!active) return null

  return createPortal(
    <div className={`${styles.overlay} ${phase === 'zoom' ? styles.zoom : ''}`} aria-hidden="true">
      <div className={styles.bg} />
      <div className={styles.ring} />
    </div>,
    document.body,
  )
}
