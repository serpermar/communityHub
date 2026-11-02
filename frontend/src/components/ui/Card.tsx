import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'
import styles from './Display.module.css' // Asumo que aquí tienes tus estilos base

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        styles.card,
        // AÑADIDO: Animaciones de hover (solo si el usuario no prefiere movimiento reducido)
        'transition-all duration-300 ease-out motion-safe:hover:-translate-y-1 motion-safe:hover:shadow-lg',
        className,
      )}
    >
      {(title || actions) && (
        <div className={styles.cardHeader}>
          {typeof title === 'string' ? <h3 className={styles.cardTitle}>{title}</h3> : title}
          {actions}
        </div>
      )}
      <div className={styles.cardContent}>{children}</div>
    </div>
  )
}
