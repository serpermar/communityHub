import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui'

export function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 px-4 text-center">
      <p className="text-sm font-medium text-brand-700">404</p>
      <h1 className="text-2xl font-semibold text-slate-800">Página no encontrada</h1>
      <p className="text-sm text-slate-500">La página que buscas no existe o se ha movido.</p>
      <Button onClick={() => navigate('/', { replace: true })}>Volver al inicio</Button>
    </div>
  )
}
