import { useId, useState, type ReactNode } from 'react'
import { cn } from '@/utils/cn'
import styles from './Tooltip.module.css'

export function Tooltip({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  const id = useId()
  const [open, setOpen] = useState(false)

  return (
    <span
      className={cn(styles.wrapper, className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false)
      }}
    >
      <span aria-describedby={open ? id : undefined}>{children}</span>
      {open && (
        <span id={id} role="tooltip" className={styles.tooltip}>
          {label}
        </span>
      )}
    </span>
  )
}
