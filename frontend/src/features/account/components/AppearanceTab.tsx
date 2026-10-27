import { useState } from 'react'
import { Button, Card, ThemeToggle, useToast } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import { ApiError } from '@/services/ApiError'
import { exportMyData } from '../api'
import styles from '../pages/AccountPage.module.css'

const roleLabel = (user: ReturnType<typeof useAuth>['user']) => {
  if (user?.globalRole === 'ADMIN_SA') return 'Administrador de plataforma'
  return user?.globalRole === 'NEIGHBOR' ? 'Usuario' : 'Usuario'
}

export function AppearanceTab({ onLogout }: { onLogout: () => void }) {
  const { user } = useAuth()
  const { notify } = useToast()
  const [exportLoading, setExportLoading] = useState(false)
  const [copiedId, setCopiedId] = useState(false)

  const copyUserId = async () => {
    if (!user?.id) return
    try {
      await navigator.clipboard.writeText(user.id)
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 1500)
    } catch {
      notify('No se ha podido copiar el ID.', 'error')
    }
  }

  const onExportData = async () => {
    setExportLoading(true)
    try {
      const blob = await exportMyData()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `communityhub-datos-${user?.id ?? 'usuario'}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
      notify('Datos exportados.', 'success')
    } catch (caught) {
      notify(ApiError.from(caught).message, 'error')
    } finally {
      setExportLoading(false)
    }
  }

  return (
    <div className={styles.sectionGap}>
      <Card title="Apariencia">
        <div className={styles.appearanceRow}>
          <div className={styles.appearanceHeader}>
            <p className={styles.appearanceTitle}>Tema</p>
            <p className={styles.appearanceDesc}>
              Elige entre claro, oscuro o seguir la preferencia del sistema.
            </p>
          </div>
          <ThemeToggle />
        </div>
      </Card>

      <Card title="Información de la cuenta">
        <div className={styles.infoList}>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>ID de usuario</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className={styles.infoValue}>{user?.id}</span>
              <Button size="sm" variant="ghost" onClick={copyUserId}>
                {copiedId ? 'Copiado' : 'Copiar'}
              </Button>
            </div>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>Rol global</span>
            <span className={styles.infoValue}>{roleLabel(user)}</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>Correo verificado</span>
            <span className={styles.infoValue}>{user?.emailVerifiedAt ? 'Sí' : 'No'}</span>
          </div>
        </div>
      </Card>

      <Card title="Privacidad y datos">
        <div className={styles.appearanceRow}>
          <div className={styles.appearanceHeader}>
            <p className={styles.appearanceTitle}>Descargar mis datos</p>
            <p className={styles.appearanceDesc}>
              Obtén una copia de tu información en formato JSON.
            </p>
          </div>
          <div>
            <Button size="sm" variant="secondary" onClick={onExportData} loading={exportLoading}>
              Descargar datos
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Zona peligrosa">
        <div className={styles.appearanceRow}>
          <div className={styles.appearanceHeader}>
            <p className={styles.appearanceTitle}>Cerrar sesión en este dispositivo</p>
            <p className={styles.appearanceDesc}>
              Finaliza la sesión actual y vuelve a la pantalla de acceso.
            </p>
          </div>
          <div>
            <Button variant="danger" onClick={onLogout}>
              Cerrar sesión
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
