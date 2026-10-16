import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, Button, Field, Input } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useAuth } from '@/context/AuthContext'
import { registerSchema, type RegisterForm } from '../schemas'

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
    <div>
      <h2 className="text-lg font-semibold text-slate-800">Crear cuenta</h2>
      <p className="mt-1 text-sm text-slate-500">Regístrate y accede con tus credenciales.</p>

      {serverError && (
        <div className="mt-4">
          <Alert variant="error">{serverError}</Alert>
        </div>
      )}
      {done && (
        <div className="mt-4">
          <Alert variant="success">{done} Redirigiendo al inicio de sesión…</Alert>
        </div>
      )}

      <form className="mt-4 space-y-4" onSubmit={onSubmit} noValidate>
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

        <Button type="submit" loading={isSubmitting} className="w-full">
          Crear cuenta
        </Button>
      </form>

      <p className="mt-4 text-center text-sm text-slate-500">
        ¿Ya tienes cuenta?{' '}
        <Link to="/login" className="font-medium text-brand-700 hover:underline">
          Inicia sesión
        </Link>
      </p>
    </div>
  )
}
