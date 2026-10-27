import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Field, Input, PageHeader } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { redeemInvitation } from '../api'
import styles from './RedeemInvitationPage.module.css'

export function RedeemInvitationPage() {
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ code: string }>({ defaultValues: { code: '' } })

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null)
    try {
      const result = await redeemInvitation(values.code.trim())
      setDone('¡Ya formas parte de la comunidad!')
      window.setTimeout(
        () => navigate(`/c/${result.communityId}/dashboard`, { replace: true }),
        900,
      )
    } catch (caught) {
      setServerError(ApiError.from(caught).message)
    }
  })

  return (
    <div className={styles.page}>
      <PageHeader
        title="Canjear invitación"
        description="Pega el código que te ha compartido el administrador de la comunidad."
      />

      <Card className={styles.card}>
        {serverError && (
          <div className={styles.errorWrapper}>
            <Alert variant="error">{serverError}</Alert>
          </div>
        )}
        {done && (
          <div className={styles.errorWrapper}>
            <Alert variant="success">{done}</Alert>
          </div>
        )}
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          <Field label="Código de invitación" htmlFor="code" error={errors.code?.message} required>
            <Input id="code" {...register('code', { required: 'El código es obligatorio.' })} />
          </Field>
          <div className={styles.formFooter}>
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              Volver
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Canjear
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
