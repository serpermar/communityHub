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
  } = useForm<{ code: string; unitNumber: string }>({
    defaultValues: { code: '', unitNumber: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null)
    try {
      const result = await redeemInvitation(
        values.code.trim(),
        values.unitNumber.trim() || undefined,
      )
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
        description="Únete a una comunidad existente con el código que te ha compartido su administrador."
      />

      <Card className={styles.card}>
        {/* Cabecera visual con icono */}
        <div className={styles.header}>
          <div className={styles.iconWrapper}>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={styles.icon}
            >
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
            </svg>
          </div>
          <div className={styles.headerText}>
            <p className={styles.headerTitle}>Introduce tus datos</p>
            <p className={styles.headerSubtitle}>
              Solo necesitas el código de invitación. La vivienda es opcional pero ayuda a tus
              vecinos a identificarte.
            </p>
          </div>
        </div>

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
          {/* Bloque 1: Código */}
          <div className={styles.section}>
            <Field
              label="Código de invitación"
              htmlFor="code"
              error={errors.code?.message}
              hint="Son 64 caracteres. Pégalo tal cual te lo han enviado."
              required
            >
              <Input
                id="code"
                {...register('code', { required: 'El código es obligatorio.' })}
                placeholder="a1b2c3d4e5f6..."
                autoComplete="off"
                className={styles.codeInput}
              />
            </Field>
          </div>

          {/* Separador visual */}
          <div className={styles.divider}>
            <span className={styles.dividerText}>y opcionalmente</span>
          </div>

          {/* Bloque 2: Vivienda */}
          <div className={styles.section}>
            <div className={styles.labelRow}>
              <label htmlFor="unitNumber" className={styles.label}>
                Vivienda
              </label>
              <span className={styles.optionalBadge}>Opcional</span>
            </div>
            <Input id="unitNumber" {...register('unitNumber')} placeholder="Ej: Portal A, 3º B" />
            <p className={styles.hint}>
              Te ayudará a identificarte en reservas, incidencias y el resto de la comunidad.
            </p>
          </div>

          {/* Botón de envío */}
          <div className={styles.formFooter}>
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              Cancelar
            </Button>
            <Button type="submit" loading={isSubmitting} className={styles.submitButton}>
              Canjear invitación
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
