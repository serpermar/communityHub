import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, Button, Field, Input } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useAuth } from '@/context/AuthContext'
import { registerSchema, type RegisterForm } from '../schemas'
import styles from './RegisterPage.module.css'

export function RegisterPage() {
  const { register: createAccount } = useAuth()
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({ resolver: zodResolver(registerSchema) })

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null)
    try {
      const result = await createAccount({
        email: values.email,
        password: values.password,
        fullName: values.fullName,
        phone: values.phone || undefined,
      })
      setDone(result.message)
      window.setTimeout(() => navigate('/login', { replace: true }), 1200)
    } catch (caught) {
      setServerError(ApiError.from(caught).message)
    }
  })

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Crear cuenta</h1>
      <p className={styles.subtitle}>Regístrate y accede con tus credenciales.</p>

      {serverError && (
        <div className={styles.alertWrap}>
          <Alert variant="error">{serverError}</Alert>
        </div>
      )}
      {done && (
        <div className={styles.alertWrap}>
          <Alert variant="success">{done} Redirigiendo al inicio de sesión…</Alert>
        </div>
      )}

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <Field label="Nombre completo" htmlFor="fullName" error={errors.fullName?.message} required>
          <Input id="fullName" autoComplete="name" {...register('fullName')} />
        </Field>

        <Field label="Correo electrónico" htmlFor="email" error={errors.email?.message} required>
          <Input id="email" type="email" autoComplete="email" {...register('email')} />
        </Field>

        <Field
          label="Contraseña"
          htmlFor="password"
          error={errors.password?.message}
          hint="Mínimo 8 caracteres."
          required
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            {...register('password')}
          />
        </Field>

        <Field label="Teléfono (opcional)" htmlFor="phone" error={errors.phone?.message}>
          <Input id="phone" autoComplete="tel" {...register('phone')} />
        </Field>

        <Button type="submit" loading={isSubmitting} className={styles.submit}>
          Crear cuenta
        </Button>
      </form>

      <p className={styles.footer}>
        ¿Ya tienes cuenta?{' '}
        <Link to="/login" className={styles.link}>
          Inicia sesión
        </Link>
      </p>
    </div>
  )
}
