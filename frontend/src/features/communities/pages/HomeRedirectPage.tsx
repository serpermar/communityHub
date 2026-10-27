import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, LoadingState } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import { useResource } from '@/hooks/useResource'
import { listCommunities } from '../api'
import styles from './HomeRedirectPage.module.css'

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
    <div className={styles.emptyCard}>
      <p className={styles.emptyTitle}>Aún no tienes ninguna comunidad</p>
      <p className={styles.emptyDescription}>
        Entra con una invitación o crea una comunidad si eres administrador de plataforma.
      </p>
      <div className={styles.actions}>
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
