import { Alert, Button, Card, Field, Input } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { changePassword } from '../api'
import { passwordSchema, type PasswordForm } from '../schemas'
import { useToast } from '@/components/ui'
import styles from '../pages/AccountPage.module.css'

export function SecurityTab() {
  const { notify } = useToast()

  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
    mode: 'onTouched',
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

  return (
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
  )
}
