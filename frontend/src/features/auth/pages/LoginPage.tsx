import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Alert, Button, Field, Input } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useAuth } from '@/context/AuthContext'
import { loginSchema, type LoginForm } from '../schemas'
import { PasswordField } from '../components/PasswordField'
import styles from './LoginPage.module.css'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isValid },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null)
    try {
      await login(values)
      const from = (location.state as { from?: string } | null)?.from
      navigate(from && from !== '/login' ? from : '/', { replace: true })
    } catch (caught) {
      setServerError(ApiError.from(caught).message)
    }
  })

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Iniciar sesión</h1>
      <p className={styles.subtitle}>Accede con tu correo y contraseña.</p>

      {serverError && (
        <div className={styles.alertWrap} aria-live="polite">
          <Alert variant="error">{serverError}</Alert>
        </div>
      )}

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <Field label="Correo electrónico" htmlFor="email" error={errors.email?.message} required>
          <Input id="email" type="email" autoComplete="email" autoFocus {...register('email')} />
        </Field>

        <Field label="Contraseña" htmlFor="password" error={errors.password?.message} required>
          <PasswordField id="password" autoComplete="current-password" {...register('password')} />
        </Field>

        <div className={styles.forgotWrap}>
          <Link to="/forgot-password" className={styles.forgotLink}>
            ¿Olvidaste tu contraseña?
          </Link>
        </div>

        <Button
          type="submit"
          loading={isSubmitting}
          disabled={!isValid || isSubmitting}
          className={styles.submit}
        >
          Entrar
        </Button>
      </form>

      <p className={styles.footer}>
        ¿No tienes cuenta?{' '}
        <Link to="/register" className={styles.link}>
          Crear una
        </Link>
      </p>
    </div>
  )
}
