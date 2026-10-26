import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  TabPanel,
  Tabs,
  ThemeToggle,
  useToast,
  type Column,
  type TabItem,
} from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useAuth } from '@/context/AuthContext'
import { useResource } from '@/hooks/useResource'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import { formatDateTime } from '@/utils/format'
import type { SessionView } from '@/types/auth'
import {
  changePassword,
  deleteAvatar,
  exportMyData,
  listSessions,
  revokeOtherSessions,
  revokeSession,
  updateProfile,
  uploadAvatar,
} from '../api'
import { passwordSchema, profileSchema, type PasswordForm, type ProfileForm } from '../schemas'
import styles from './AccountPage.module.css'

type AccountTab = 'profile' | 'security' | 'sessions' | 'appearance'

export function AccountPage() {
  const navigate = useNavigate()
  const { user, logout, reload } = useAuth()
  const { notify } = useToast()
  const [error, setError] = useState<string | null>(null)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [revokeOthersOpen, setRevokeOthersOpen] = useState(false)
  const [avatarLoading, setAvatarLoading] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [copiedId, setCopiedId] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sessions = useResource(() => listSessions(), [])
  const [activeTab, setActiveTab] = useState<AccountTab>('profile')

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

  const tabs: TabItem<AccountTab>[] = [
    { value: 'profile', label: 'Perfil' },
    { value: 'security', label: 'Seguridad' },
    { value: 'sessions', label: 'Sesiones' },
    { value: 'appearance', label: 'Apariencia' },
  ]

  const profileForm = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: { fullName: user?.fullName ?? '', phone: user?.phone ?? '' },
    mode: 'onTouched',
  })

  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
    mode: 'onTouched',
  })

  const profileLeave = useUnsavedChanges(profileForm.formState.isDirty)

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

  const revokeOthers = async () => {
    setError(null)
    try {
      await revokeOtherSessions()
      sessions.reload()
      notify('Otras sesiones cerradas.', 'success')
    } catch (caught) {
      setError(ApiError.from(caught).message)
    } finally {
      setRevokeOthersOpen(false)
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

  const onAvatarChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setAvatarLoading(true)
    try {
      await uploadAvatar(file)
      await reload()
      notify('Avatar actualizado.', 'success')
    } catch (caught) {
      notify(ApiError.from(caught).message, 'error')
    } finally {
      setAvatarLoading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const onAvatarDelete = async () => {
    setAvatarLoading(true)
    try {
      await deleteAvatar()
      await reload()
      notify('Avatar eliminado.', 'success')
    } catch (caught) {
      notify(ApiError.from(caught).message, 'error')
    } finally {
      setAvatarLoading(false)
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
            <Badge tone="green" className={styles.badgeWrap}>
              Este dispositivo
            </Badge>
          )}
        </span>
      ),
    },
    { key: 'ip', header: 'IP', render: (row) => row.ipAddress ?? '—' },
    {
      key: 'created',
      header: 'Iniciada',
      render: (row) => formatDateTime(row.createdAt),
    },
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
          <div className={styles.actionsRight}>
            <Button size="sm" variant="danger" onClick={() => void revoke(row)}>
              Cerrar
            </Button>
          </div>
        ),
    },
  ]

  const roleLabel =
    user?.globalRole === 'ADMIN'
      ? 'Administrador'
      : user?.globalRole === 'PRESIDENT'
        ? 'Presidente'
        : user?.globalRole === 'PROVIDER'
          ? 'Proveedor'
          : 'Vecino'

  return (
    <div className={styles.page}>
      <button type="button" onClick={() => navigate(-1)} className={styles.backLink}>
        ← Volver
      </button>

      <PageHeader title="Mi cuenta" />

      <Card>
        <div className={styles.headerCard}>
          <div className={styles.profileInfo}>
            <div className={styles.avatarLarge}>
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.fullName} className={styles.avatarImg} />
              ) : (
                (user?.fullName?.[0] || user?.email?.[0] || '?').toUpperCase()
              )}
            </div>
            <div className={styles.profileText}>
              <p className={styles.profileName}>{user?.fullName}</p>
              <div className={styles.profileMeta}>
                <span>{user?.email}</span>
                <span className={styles.metaDot}>·</span>
                <span>{roleLabel}</span>
                {user?.emailVerifiedAt && (
                  <>
                    <span className={styles.metaDot}>·</span>
                    <Badge tone="green">Verificado</Badge>
                  </>
                )}
                {user?.createdAt && (
                  <>
                    <span className={styles.metaDot}>·</span>
                    <span>Miembro desde {formatDateTime(user.createdAt).split(',')[0]}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className={styles.avatarActions}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className={styles.hiddenInput}
              onChange={onAvatarChange}
            />
            <Button size="sm" onClick={() => fileInputRef.current?.click()} loading={avatarLoading}>
              Cambiar avatar
            </Button>
            {user?.avatarUrl && (
              <Button size="sm" variant="ghost" onClick={onAvatarDelete} loading={avatarLoading}>
                Quitar avatar
              </Button>
            )}
          </div>
        </div>
      </Card>

      <div className={styles.tabsWrap}>
        <Tabs items={tabs} value={activeTab} onChange={setActiveTab} ariaLabel="Secciones de cuenta" />
      </div>

      <TabPanel value="profile" active={activeTab}>
        <div className={styles.sectionGap}>
          <Card title="Datos personales">
            <form className={styles.form} onSubmit={onSubmitProfile} noValidate>
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
              <dl className={styles.metaGrid}>
                <div>
                  <dt className={styles.metaLabel}>Correo</dt>
                  <dd className={styles.metaValue}>{user?.email}</dd>
                </div>
                <div>
                  <dt className={styles.metaLabel}>Miembro desde</dt>
                  <dd className={styles.metaValue}>
                    {user?.createdAt ? formatDateTime(user.createdAt) : '—'}
                  </dd>
                </div>
              </dl>
              <p className={styles.metaHint}>El correo no se puede cambiar desde aquí.</p>
              <div className={styles.actionsEnd}>
                <Button type="submit" loading={profileForm.formState.isSubmitting}>
                  Guardar cambios
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </TabPanel>

      <TabPanel value="security" active={activeTab}>
        <div className={styles.sectionGap}>
          <Card title="Cambiar contraseña">
            <form className={styles.form} onSubmit={onSubmitPassword} noValidate>
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
              <div className={styles.actionsEnd}>
                <Button type="submit" loading={passwordForm.formState.isSubmitting}>
                  Cambiar contraseña
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </TabPanel>

      <TabPanel value="sessions" active={activeTab}>
        <div className={styles.sectionGap}>
          <Card
            title={
              sessions.data
                ? `Sesiones activas (${sessions.data.length})`
                : 'Sesiones activas'
            }
            actions={
              sessions.data?.some((s) => !s.current) ? (
                <Button size="sm" variant="ghost" onClick={() => setRevokeOthersOpen(true)}>
                  Cerrar todas las demás
                </Button>
              ) : null
            }
          >
            {error && (
              <div style={{ marginBottom: '0.75rem' }}>
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
                empty={<p className={styles.emptyText}>No hay sesiones.</p>}
              />
            ) : null}
          </Card>
        </div>
      </TabPanel>

      <TabPanel value="appearance" active={activeTab}>
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
                <span className={styles.infoValue}>{roleLabel}</span>
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
                <Button variant="danger" onClick={() => setLogoutOpen(true)}>
                  Cerrar sesión
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </TabPanel>



      <ConfirmDialog
        open={logoutOpen}
        title="Cerrar sesión"
        description="Se cerrará la sesión en este dispositivo y volverás a la pantalla de acceso."
        confirmLabel="Cerrar sesión"
        onCancel={() => setLogoutOpen(false)}
        onConfirm={() => logout().then(() => navigate('/login', { replace: true }))}
      />

      <ConfirmDialog
        open={revokeOthersOpen}
        title="Cerrar todas las demás sesiones"
        description="Se cerrarán todas las sesiones excepto la actual. ¿Continuar?"
        confirmLabel="Cerrar demás sesiones"
        onCancel={() => setRevokeOthersOpen(false)}
        onConfirm={() => void revokeOthers()}
      />

      <ConfirmDialog
        open={profileLeave.blocked}
        title="Cambios sin guardar"
        description="Tienes cambios sin guardar en tu perfil. Si sales ahora, se perderán."
        confirmLabel="Salir sin guardar"
        cancelLabel="Seguir editando"
        onConfirm={profileLeave.confirm}
        onCancel={profileLeave.cancel}
      />
    </div>
  )
}
