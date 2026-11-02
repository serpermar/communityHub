import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { LoadingState } from '@/components/ui'
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
      // CAMBIO: Redirigimos usando el slug, no el id
      navigate(`/c/${data[0].slug}/dashboard`, { replace: true })
    }
  }, [data, navigate])

  if (loading) return <LoadingState />

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {/* Icono principal */}
        <div className={styles.iconWrapper}>
          <svg
            aria-hidden="true"
            viewBox="0 0 48 48"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={styles.icon}
          >
            <path d="M8 40V20l16-12 16 12v20" />
            <path d="M18 40V28h12v12" />
            <circle cx="24" cy="20" r="3" fill="currentColor" stroke="none" />
          </svg>
        </div>

        {/* Título y descripción */}
        <h1 className={styles.title}>Aún no tienes ninguna comunidad</h1>
        <p className={styles.description}>
          Entra con una invitación o crea una comunidad si eres administrador de plataforma.
        </p>

        {/* Opciones */}
        <div className={styles.options}>
          {/* Opción 1: Canjear invitación */}
          <button
            type="button"
            onClick={() => navigate('/invitations/redeem')}
            className={styles.option}
          >
            <div className={styles.optionIcon}>
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
            </div>
            <div className={styles.optionText}>
              <p className={styles.optionTitle}>Tengo un código de invitación</p>
              <p className={styles.optionDesc}>
                Pega el código que te ha compartido el administrador de tu comunidad.
              </p>
            </div>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={styles.optionArrow}
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>

          {/* Opción 2: Crear comunidad (solo ADMIN_SA) */}
          {user?.globalRole === 'ADMIN_SA' && (
            <button
              type="button"
              onClick={() => navigate('/admin/communities/new')}
              className={styles.option}
            >
              <div className={styles.optionIcon}>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </div>
              <div className={styles.optionText}>
                <p className={styles.optionTitle}>Crear una nueva comunidad</p>
                <p className={styles.optionDesc}>
                  Eres administrador de plataforma. Puedes dar de alta una comunidad desde cero.
                </p>
              </div>
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={styles.optionArrow}
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
