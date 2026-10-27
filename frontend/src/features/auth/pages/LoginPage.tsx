import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Alert, Button, Field, Input } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useAuth } from '@/context/AuthContext'
import { loginSchema, type LoginForm } from '../schemas'
import styles from './LoginPage.module.css'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) })

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
        <div className={styles.alertWrap}>
          <Alert variant="error">{serverError}</Alert>
        </div>
      )}

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <Field label="Correo electrónico" htmlFor="email" error={errors.email?.message} required>
          <Input id="email" type="email" autoComplete="email" {...register('email')} />
        </Field>

        <Field label="Contraseña" htmlFor="password" error={errors.password?.message} required>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            {...register('password')}
          />
        </Field>

        <Button type="submit" loading={isSubmitting} className={styles.submit}>
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
