import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Alert, Button, Field, Input } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useAuth } from '@/context/AuthContext'
import { loginSchema, type LoginForm } from '../schemas'

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
    <div>
      <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Iniciar sesión</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Accede con tu correo y contraseña.
      </p>

      {serverError && (
        <div className="mt-4">
          <Alert variant="error">{serverError}</Alert>
        </div>
      )}

      <form className="mt-4 space-y-4" onSubmit={onSubmit} noValidate>
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

        <Button type="submit" loading={isSubmitting} className="w-full">
          Entrar
        </Button>
      </form>

      <p className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
        ¿No tienes cuenta?{' '}
        <Link
          to="/register"
          className="font-medium text-brand-700 dark:text-brand-400 hover:underline"
        >
          Crear una
        </Link>
      </p>
    </div>
  )
}
