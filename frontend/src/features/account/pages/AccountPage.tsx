import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  ErrorState,
  Field,
  Input,
  LoadingState,
  useToast,
  type Column,
} from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useAuth } from '@/context/AuthContext'
import { useResource } from '@/hooks/useResource'
import { formatDateTime } from '@/utils/format'
import type { SessionView } from '@/types/auth'
import { changePassword, listSessions, revokeSession, updateProfile } from '../api'
import { passwordSchema, profileSchema, type PasswordForm, type ProfileForm } from '../schemas'

export function AccountPage() {
  const navigate = useNavigate()
  const { user, logout, reload } = useAuth()
  const { notify } = useToast()
  const [error, setError] = useState<string | null>(null)
  const sessions = useResource(() => listSessions(), [])

  const profileForm = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: { fullName: user?.fullName ?? '', phone: user?.phone ?? '' },
  })

  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })

  useEffect(() => {
    profileForm.reset({ fullName: user?.fullName ?? '', phone: user?.phone ?? '' })
  }, [user, profileForm])

  const onSubmitProfile = profileForm.handleSubmit(async (values) => {
    try {
      await updateProfile({ fullName: values.fullName, phone: values.phone || undefined })
      await reload()
      notify('Perfil actualizado.', 'success')
    } catch (caught) {
      profileForm.setError('root', { message: ApiError.from(caught).message })
    }
  })

  const onSubmitPassword = passwordForm.handleSubmit(async (values) => {
    try {
      await changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      })
      passwordForm.reset()
      notify('Contraseña cambiada. Se han cerrado las demás sesiones.', 'success')
    } catch (caught) {
      const apiError = ApiError.from(caught)
      if (apiError.code === 'CURRENT_PASSWORD_INVALID') {
        passwordForm.setError('currentPassword', { message: apiError.message })
      } else {
        passwordForm.setError('root', { message: apiError.message })
      }
    }
  })

  const revoke = async (session: SessionView) => {
    setError(null)
    try {
      await revokeSession(session.id)
      sessions.reload()
    } catch (caught) {
      setError(ApiError.from(caught).message)
    }
  }

  const columns: Column<SessionView>[] = [
    {
      key: 'device',
      header: 'Dispositivo',
      render: (row) => (
        <span>
          {row.userAgent ?? 'Desconocido'}
          {row.current && (
            <Badge tone="green" className="ml-2">
              Actual
            </Badge>
          )}
        </span>
      ),
    },
    { key: 'ip', header: 'IP', render: (row) => row.ipAddress ?? '—' },
    {
      key: 'lastUsed',
      header: 'Última actividad',
      render: (row) => (row.lastUsedAt ? formatDateTime(row.lastUsedAt) : '—'),
    },
    {
      key: 'actions',
      header: '',
      render: (row) =>
        row.current ? null : (
          <div className="flex justify-end">
            <Button size="sm" variant="danger" onClick={() => void revoke(row)}>
              Cerrar
            </Button>
          </div>
        ),
    },
  ]

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-700 dark:hover:text-brand-400"
      >
        ← Volver
      </button>

      <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Mi cuenta</h1>

      <Card title="Datos de la cuenta">
        <form className="space-y-4" onSubmit={onSubmitProfile} noValidate>
          {profileForm.formState.errors.root && (
            <Alert variant="error">{profileForm.formState.errors.root.message}</Alert>
          )}
          <Field
            label="Nombre"
            htmlFor="fullName"
            error={profileForm.formState.errors.fullName?.message}
            required
          >
            <Input id="fullName" {...profileForm.register('fullName')} />
          </Field>
          <Field
            label="Teléfono"
            htmlFor="phone"
            error={profileForm.formState.errors.phone?.message}
            hint="Déjalo vacío para borrarlo."
          >
            <Input id="phone" {...profileForm.register('phone')} />
          </Field>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-slate-400 dark:text-slate-500">Correo</dt>
              <dd className="text-slate-700 dark:text-slate-200">{user?.email}</dd>
            </div>
            <div>
              <dt className="text-slate-400 dark:text-slate-500">Verificado</dt>
              <dd className="text-slate-700 dark:text-slate-200">
                {user?.emailVerifiedAt ? 'Sí' : 'No'}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            El correo no se puede cambiar desde aquí.
          </p>
          <div className="flex justify-end">
            <Button type="submit" loading={profileForm.formState.isSubmitting}>
              Guardar cambios
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Contraseña">
        <form className="space-y-4" onSubmit={onSubmitPassword} noValidate>
          {passwordForm.formState.errors.root && (
            <Alert variant="error">{passwordForm.formState.errors.root.message}</Alert>
          )}
          <Field
            label="Contraseña actual"
            htmlFor="currentPassword"
            error={passwordForm.formState.errors.currentPassword?.message}
            required
          >
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              {...passwordForm.register('currentPassword')}
            />
          </Field>
          <Field
            label="Nueva contraseña"
            htmlFor="newPassword"
            error={passwordForm.formState.errors.newPassword?.message}
            hint="Mínimo 12 caracteres."
            required
          >
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              {...passwordForm.register('newPassword')}
            />
          </Field>
          <Field
            label="Repite la nueva contraseña"
            htmlFor="confirmPassword"
            error={passwordForm.formState.errors.confirmPassword?.message}
            required
          >
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              {...passwordForm.register('confirmPassword')}
            />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" loading={passwordForm.formState.isSubmitting}>
              Cambiar contraseña
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Sesiones activas">
        {error && (
          <div className="mb-3">
            <Alert variant="error">{error}</Alert>
          </div>
        )}
        {sessions.loading ? (
          <LoadingState />
        ) : sessions.error ? (
          <ErrorState error={sessions.error} onRetry={sessions.reload} />
        ) : sessions.data ? (
          <DataTable
            columns={columns}
            rows={sessions.data}
            rowKey={(row) => row.id}
            empty={<p className="text-sm text-slate-500 dark:text-slate-400">No hay sesiones.</p>}
          />
        ) : null}
      </Card>

      <Button
        variant="danger"
        onClick={() => void logout().then(() => navigate('/login', { replace: true }))}
      >
        Cerrar sesión en este dispositivo
      </Button>
    </div>
  )
}
