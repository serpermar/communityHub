import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

/**
 * Cabecera de página: título, subtítulo y acciones a la derecha. Centraliza el
 * patrón que antes se repetía en cada pantalla (`text-xl font-semibold …`), para
 * que el espaciado y la tipografía no diverjan entre módulos.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h1 className="text-page-title text-slate-800 dark:text-slate-100">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
