import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, Button, Card, Field, Input, LoadingState, PageHeader } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { geocodeCommunity, getCommunity, getCommunityWeather, updateCommunity } from '../api'
import { updateCommunitySchema, type UpdateCommunityForm } from '../schemas'

export function CommunitySettingsPage() {
  const { active } = useCommunity()
  const [serverError, setServerError] = useState<string | null>(null)
  const [geocoding, setGeocoding] = useState(false)

  const community = useResource(() => getCommunity(active!.id), [active?.id])
  const weather = useResource(() => getCommunityWeather(active!.id), [active?.id])

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UpdateCommunityForm>({ resolver: zodResolver(updateCommunitySchema) })

  useEffect(() => {
    if (community.data) {
      reset({
        name: community.data.name,
        description: community.data.description ?? '',
        addressLine1: community.data.addressLine1,
        city: community.data.city,
        isActive: community.data.isActive,
      })
    }
  }, [community.data, reset])

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null)
    try {
      await updateCommunity(active!.id, {
        name: values.name,
        description: values.description || null,
        addressLine1: values.addressLine1,
        city: values.city,
        isActive: values.isActive,
      })
      await community.reload()
    } catch (caught) {
      setServerError(ApiError.from(caught).message)
    }
  })

  const onGeocode = async () => {
    setServerError(null)
    setGeocoding(true)
    try {
      await geocodeCommunity(active!.id)
      await community.reload()
    } catch (caught) {
      setServerError(ApiError.from(caught).message)
    } finally {
      setGeocoding(false)
    }
  }

  if (community.loading) return <LoadingState label="Cargando ajustes…" />
  if (community.error) return <Alert variant="error">{community.error.message}</Alert>

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Ajustes de la comunidad" />

      <Card title="Datos generales">
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
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" {...register('isActive')} />
            Comunidad activa
          </label>
          <div className="flex justify-between gap-2">
            <Button type="button" variant="secondary" loading={geocoding} onClick={onGeocode}>
              Localizar por dirección
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Guardar cambios
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Meteorología del barrio">
        {weather.data ? (
          <p className="text-sm text-slate-700 dark:text-slate-200">
            {weather.data.current.temperatureC} °C (sensación{' '}
            {weather.data.current.apparentTemperatureC} °C) · {weather.data.current.condition}. Máx{' '}
            {weather.data.today.maxC} °C / Mín {weather.data.today.minC} °C.
          </p>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No hay datos meteorológicos (la comunidad aún no tiene coordenadas o el proveedor no
            responde).
          </p>
        )}
      </Card>
    </div>
  )
}
