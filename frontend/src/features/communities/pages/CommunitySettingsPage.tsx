import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Input,
  LoadingState,
  PageHeader,
} from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import { geocodeCommunity, getCommunity, getCommunityWeather, updateCommunity } from '../api'
import { updateCommunitySchema, type UpdateCommunityForm } from '../schemas'
import styles from './CommunitySettingsPage.module.css'

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
    formState: { errors, isSubmitting, isDirty },
  } = useForm<UpdateCommunityForm>({
    resolver: zodResolver(updateCommunitySchema),
    mode: 'onTouched',
  })

  const { blocked, confirm, cancel } = useUnsavedChanges(isDirty)

  useEffect(() => {
    if (community.data) {
      reset({
        name: community.data.name,
        slug: community.data.slug, // <-- AÑADIDO
        description: community.data.description ?? '',
        addressLine1: community.data.addressLine1,
        city: community.data.city,
        province: community.data.province ?? '',
        postalCode: community.data.postalCode ?? '',
        isActive: community.data.isActive,
      })
    }
  }, [community.data, reset])

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null)
    try {
      await updateCommunity(active!.id, {
        name: values.name,
        slug: values.slug, // <-- AÑADIDO
        description: values.description || null,
        addressLine1: values.addressLine1,
        city: values.city,
        province: values.province,
        postalCode: values.postalCode,
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
      if (isDirty) {
        await handleSubmit(async (values) => {
          await updateCommunity(active!.id, {
            name: values.name,
            slug: values.slug, // <-- AÑADIDO
            description: values.description || null,
            addressLine1: values.addressLine1,
            city: values.city,
            province: values.province,
            postalCode: values.postalCode,
            isActive: values.isActive,
          })
        })()
      }

      await geocodeCommunity(active!.id)
      await community.reload()
      await weather.reload()
    } catch (caught) {
      setServerError(ApiError.from(caught).message)
    } finally {
      setGeocoding(false)
    }
  }

  if (community.loading) return <LoadingState label="Cargando ajustes…" />
  if (community.error) return <Alert variant="error">{community.error.message}</Alert>

  return (
    <div className={styles.page}>
      <PageHeader title="Ajustes de la comunidad" />

      <Card title="Datos generales">
        {serverError && (
          <div className={styles.errorWrapper}>
            <Alert variant="error">{serverError}</Alert>
          </div>
        )}
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          <Field label="Nombre" htmlFor="name" error={errors.name?.message} required>
            <Input id="name" {...register('name')} />
          </Field>

          <Field
            label="Identificador (slug)"
            htmlFor="slug"
            error={errors.slug?.message}
            hint="Afecta a la URL. Cambiarlo romperá los enlaces antiguos."
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

          <div className={styles.formRow}>
            <Field label="Ciudad" htmlFor="city" error={errors.city?.message} required>
              <Input id="city" {...register('city')} />
            </Field>
            <Field label="Provincia" htmlFor="province" error={errors.province?.message} required>
              <Input id="province" {...register('province')} />
            </Field>
          </div>

          <Field
            label="Código Postal"
            htmlFor="postalCode"
            error={errors.postalCode?.message}
            required
          >
            <Input id="postalCode" {...register('postalCode')} />
          </Field>

          <Field label="Descripción" htmlFor="description" error={errors.description?.message}>
            <Input id="description" {...register('description')} />
          </Field>

          <label className={styles.checkboxLabel}>
            <input type="checkbox" {...register('isActive')} />
            Comunidad activa
          </label>

          <div className={styles.formFooter}>
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
          <p className={styles.weatherText}>
            {weather.data.current.temperatureC} °C (sensación{' '}
            {weather.data.current.apparentTemperatureC} °C) · {weather.data.current.condition}. Máx{' '}
            {weather.data.today.maxC} °C / Mín {weather.data.today.minC} °C.
          </p>
        ) : (
          <p className={styles.emptyWeather}>
            No hay datos meteorológicos (la comunidad aún no tiene coordenadas o el proveedor no
            responde).
          </p>
        )}
      </Card>

      <ConfirmDialog
        open={blocked}
        title="Cambios sin guardar"
        description="Tienes cambios sin guardar en los ajustes. Si sales ahora, se perderán."
        confirmLabel="Salir sin guardar"
        cancelLabel="Seguir editando"
        onConfirm={confirm}
        onCancel={cancel}
      />
    </div>
  )
}
