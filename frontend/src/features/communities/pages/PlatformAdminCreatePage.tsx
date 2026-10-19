import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Field, Input } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { createCommunity } from '../api'
import { createCommunitySchema, type CreateCommunityForm } from '../schemas'

export function PlatformAdminCreatePage() {
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateCommunityForm>({ resolver: zodResolver(createCommunitySchema) })

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null)
    try {
      const community = await createCommunity({
        name: values.name,
        slug: values.slug,
        addressLine1: values.addressLine1,
        city: values.city,
        description: values.description || undefined,
      })
      navigate(`/c/${community.id}/dashboard`, { replace: true })
    } catch (caught) {
      setServerError(ApiError.from(caught).message)
    }
  })

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-xl font-semibold text-slate-800">Nueva comunidad</h1>
      <p className="mt-1 text-sm text-slate-500">
        Se te asignará como primer administrador de la comunidad creada.
      </p>

      <Card className="mt-4">
        {serverError && (
          <div className="mb-4">
            <Alert variant="error">{serverError}</Alert>
          </div>
        )}
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <Field label="Nombre" htmlFor="name" error={errors.name?.message} required>
            <Input id="name" {...register('name')} />
          </Field>
          <Field
            label="Identificador (slug)"
            htmlFor="slug"
            error={errors.slug?.message}
            hint="Minúsculas, números y guiones. No se podrá cambiar."
            required
          >
            <Input id="slug" {...register('slug')} />
          </Field>
          <Field
            label="Dirección"
            htmlFor="addressLine1"
            error={errors.addressLine1?.message}
            required
          >
            <Input id="addressLine1" {...register('addressLine1')} />
          </Field>
          <Field label="Ciudad" htmlFor="city" error={errors.city?.message} required>
            <Input id="city" {...register('city')} />
          </Field>
          <Field label="Descripción" htmlFor="description" error={errors.description?.message}>
            <Input id="description" {...register('description')} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              Cancelar
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Crear comunidad
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
