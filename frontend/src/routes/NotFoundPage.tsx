import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui'

export function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface-muted px-4 text-center dark:bg-slate-900">
      <p className="text-sm font-medium text-brand-700 dark:text-brand-400">404</p>
      <h1 className="text-2xl font-semibold text-slate-800 dark:text-slate-100">
        Página no encontrada
      </h1>
      <p className="text-sm text-slate-500 dark:text-slate-400">
        La página que buscas no existe o se ha movido.
      </p>
      <Button onClick={() => navigate('/', { replace: true })}>Volver al inicio</Button>
    </div>
  )
}
