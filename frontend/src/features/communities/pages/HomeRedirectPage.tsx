import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, LoadingState } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import { useResource } from '@/hooks/useResource'
import { listCommunities } from '../api'

/** `/` redirige a la primera comunidad del usuario (decision FE-5). */
export function HomeRedirectPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data, loading } = useResource(() => listCommunities(), [])

  useEffect(() => {
    if (data && data.length > 0) {
      navigate(`/c/${data[0].id}/dashboard`, { replace: true })
    }
  }, [data, navigate])

  if (loading) return <LoadingState />

  return (
    <div className="mx-auto max-w-lg rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-8 text-center">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
        Aún no tienes ninguna comunidad
      </p>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Entra con una invitación o crea una comunidad si eres administrador de plataforma.
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <Button variant="secondary" onClick={() => navigate('/invitations/redeem')}>
          Canjear invitación
        </Button>
        {user?.globalRole === 'ADMIN_SA' && (
          <Button onClick={() => navigate('/admin/communities/new')}>Crear comunidad</Button>
        )}
      </div>
    </div>
  )
}
