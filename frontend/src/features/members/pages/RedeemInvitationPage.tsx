import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Field, Input } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { redeemInvitation } from '../api'

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
    <div className="mx-auto max-w-lg">
      <h1 className="text-xl font-semibold text-slate-800">Canjear invitación</h1>
      <p className="mt-1 text-sm text-slate-500">
        Pega el código que te ha compartido el administrador de la comunidad.
      </p>

      <Card className="mt-4">
        {serverError && (
          <div className="mb-4">
            <Alert variant="error">{serverError}</Alert>
          </div>
        )}
        {done && (
          <div className="mb-4">
            <Alert variant="success">{done}</Alert>
          </div>
        )}
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <Field label="Código de invitación" htmlFor="code" error={errors.code?.message} required>
            <Input id="code" {...register('code', { required: 'El código es obligatorio.' })} />
          </Field>
          <div className="flex justify-end gap-2">
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
