import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui'
import styles from './NotFoundPage.module.css'

export function NotFoundPage() {
  const navigate = useNavigate()
  return (
    <div className={styles.root}>
      <p className={styles.code}>404</p>
      <h1 className={styles.title}>Página no encontrada</h1>
      <p className={styles.message}>La página que buscas no existe o se ha movido.</p>
      <Button onClick={() => navigate('/', { replace: true })}>Volver al inicio</Button>
    </div>
  )
}
