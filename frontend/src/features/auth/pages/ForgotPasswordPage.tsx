import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Button, Field, Input } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { requestPasswordReset } from '../api'
import styles from './LoginPage.module.css'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setDone(null)
    setLoading(true)
    try {
      const result = await requestPasswordReset(email)
      setDone(result.message)
    } catch (caught) {
      setError(ApiError.from(caught).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Recuperar contraseña</h1>
      <p className={styles.subtitle}>Te enviaremos un enlace para restablecerla.</p>

      {error && (
        <div className={styles.alertWrap} aria-live="polite">
          <Alert variant="error">{error}</Alert>
        </div>
      )}
      {done && (
        <div className={styles.alertWrap} aria-live="polite">
          <Alert variant="success">{done}</Alert>
        </div>
      )}

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <Field label="Correo electrónico" htmlFor="email" required>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>

        <Button
          type="submit"
          loading={loading}
          disabled={loading || !email.trim()}
          className={styles.submit}
        >
          Enviar enlace
        </Button>
      </form>

      <p className={styles.footer}>
        <Link to="/login" className={styles.link}>
          Volver a iniciar sesión
        </Link>
      </p>
    </div>
  )
}
