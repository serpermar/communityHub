import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Field, Input, Select, Textarea } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useCommunity } from '@/context/CommunityContext'
import { createIncident } from '../api'
import { createIncidentSchema, type CreateIncidentForm } from '../schemas'
import {
  CATEGORY_LABELS,
  INCIDENT_CATEGORIES,
  INCIDENT_PRIORITIES,
  PRIORITY_LABELS,
} from '../types'

export function IncidentCreatePage() {
  const { active } = useCommunity()
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateIncidentForm>({
    resolver: zodResolver(createIncidentSchema),
    defaultValues: { category: 'OTHER', priority: 'MEDIUM' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null)
    try {
      const created = await createIncident(active!.id, {
        title: values.title,
        description: values.description,
        category: values.category,
        priority: values.priority,
        location: values.location || null,
      })
      navigate(`/c/${active!.id}/incidents/${created.id}`, { replace: true })
    } catch (caught) {
      setServerError(ApiError.from(caught).message)
    }
  })

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-xl font-semibold text-slate-800">Nueva incidencia</h1>
      <Card className="mt-4">
        {serverError && (
          <div className="mb-4">
            <Alert variant="error">{serverError}</Alert>
          </div>
        )}
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <Field label="Título" htmlFor="title" error={errors.title?.message} required>
            <Input id="title" {...register('title')} />
          </Field>
          <Field
            label="Descripción"
            htmlFor="description"
            error={errors.description?.message}
            required
          >
            <Textarea id="description" rows={5} {...register('description')} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Categoría" htmlFor="category" error={errors.category?.message}>
              <Select id="category" {...register('category')}>
                {INCIDENT_CATEGORIES.flatMap((value) => (
                  <option key={value} value={value}>
                    {CATEGORY_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Prioridad" htmlFor="priority" error={errors.priority?.message}>
              <Select id="priority" {...register('priority')}>
                {INCIDENT_PRIORITIES.flatMap((value) => (
                  <option key={value} value={value}>
                    {PRIORITY_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Ubicación" htmlFor="location" error={errors.location?.message}>
            <Input id="location" placeholder="Portal, planta, zona…" {...register('location')} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              Cancelar
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Crear incidencia
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
