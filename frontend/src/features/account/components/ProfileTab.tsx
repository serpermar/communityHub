import { Alert, Button, Card, Field, Input } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useAuth } from '@/context/AuthContext'
import { formatDateTime } from '@/utils/format'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { updateProfile } from '../api'
import { profileSchema, type ProfileForm } from '../schemas'
import { useToast } from '@/components/ui'
import styles from '../pages/AccountPage.module.css'

export function ProfileTab() {
  const { user, reload } = useAuth()
  const { notify } = useToast()

  const profileForm = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: { fullName: user?.fullName ?? '', phone: user?.phone ?? '' },
    mode: 'onTouched',
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

  return (
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
  )
}
