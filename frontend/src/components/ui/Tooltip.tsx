import { useId, useState, type ReactNode } from 'react'
import { cn } from '@/utils/cn'

/**
 * Tooltip accesible para botones/iconos sin etiqueta visible. Se muestra al
 * pasar el ratón o al enfocar con el teclado, y se oculta con Escape. Usa
 * `role="tooltip"` + `aria-describedby` para que los lectores de pantalla lo
 * anuncien.
 */
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
      className={cn('relative inline-flex', className)}
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
        <span
          id={id}
          role="tooltip"
          className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-control bg-slate-900 px-2 py-1 text-meta text-white shadow-overlay dark:bg-slate-100 dark:text-slate-900"
        >
          {label}
        </span>
      )}
    </span>
  )
}
