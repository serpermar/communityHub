import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Building2, ShieldCheck } from 'lucide-react'
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Input,
  Textarea,
  ThemeToggle,
  useToast,
} from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import { createCommunity } from '../api'
import { createCommunitySchema, type CreateCommunityForm } from '../schemas'
import styles from './PlatformAdminCreatePage.module.css'

/**
 * Convierte el nombre en un slug probable: minusculas, sin acentos y con guiones.
 *
 * Es una ayuda, no una regla: el usuario puede corregirlo y, una vez que lo
 * toca, dejamos de proponerle valores. Sin esto, el campo se queda vacio y el
 * usuario tiene que inventarse a mano algo que ya sabemos derivar del nombre.
 */
function toSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 60)
    .replace(/-+$/, '')
}

/**
 * Alta de comunidad. Solo ADMIN_SA (lo garantiza `GlobalRoleGate` en el router).
 *
 * Esta pantalla cuelga de `ProtectedRoute` pero no de `AppLayout`, igual que
 * `HomeRedirectPage`, que es la que lleva aqui. Por eso se pinta sola, con su
 * fondo y su marco, y no usa `PageHeader`: no hay cabecera de aplicacion encima
 * contra la que alinear el titulo.
 */
export function PlatformAdminCreatePage() {
  const navigate = useNavigate()
  const { notify } = useToast()
  const [serverError, setServerError] = useState<string | null>(null)
  // Slug de la comunidad recien creada. Guardar el slug (y no un `boolean`)
  // permite redirigir desde un efecto, ya con el bloqueo de cambios desarmado.
  const [createdSlug, setCreatedSlug] = useState<string | null>(null)
  // Marca si el usuario ya ha escrito el slug. Mientras sea `false`, se propone
  // a partir del nombre.
  const slugEdited = useRef(false)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<CreateCommunityForm>({
    resolver: zodResolver(createCommunitySchema),
    mode: 'onTouched',
    defaultValues: {
      name: '',
      slug: '',
      addressLine1: '',
      city: '',
      province: '',
      postalCode: '',
      description: '',
    },
  })

  const nameValue = watch('name')
  const slugValue = watch('slug')

  useEffect(() => {
    if (slugEdited.current) return
    setValue('slug', toSlug(nameValue ?? ''), { shouldValidate: false })
  }, [nameValue, setValue])

  // Tras crear, se navega fuera: sin `createdSlug` el bloqueo de cambios sin
  // guardar frenaria la propia redireccion.
  const { blocked, confirm, cancel } = useUnsavedChanges(isDirty && !createdSlug)

  // La redireccion vive en un efecto a proposito. Llamar a `navigate` justo
  // despues de `setCreatedSlug` no servia: en ese instante React aun no habia
  // re-renderizado, el `useBlocker` seguia armado y se tragaba la navegacion, asi
  // que la comunidad se creaba pero el usuario se quedaba en el formulario.
  // La ruta usa `:communitySlug`, no el id, de ahi que se guarde el slug.
  useEffect(() => {
    if (!createdSlug) return
    const target = `/c/${createdSlug}/dashboard`
    navigate(target, { replace: true })
  }, [createdSlug, navigate])

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null)
    try {
      const community = await createCommunity({
        name: values.name,
        slug: values.slug,
        addressLine1: values.addressLine1,
        city: values.city,
        province: values.province,
        postalCode: values.postalCode,
        description: values.description || undefined,
      })
      setCreatedSlug(community.slug)
      notify('Comunidad creada. Ya eres su administrador.', 'success')
    } catch (caught) {
      setServerError(ApiError.from(caught).message)
    }
  })

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.topBar}>
          <button type="button" className={styles.back} onClick={() => navigate(-1)}>
            <ArrowLeft size={16} aria-hidden="true" />
            Volver
          </button>
          <ThemeToggle />
        </div>

        <header className={styles.hero}>
          <div className={styles.heroBadge} aria-hidden="true">
            <Building2 size={26} />
          </div>
          <div className={styles.heroText}>
            <p className={styles.eyebrow}>Administración de plataforma</p>
            <h1 className={styles.title}>Nueva comunidad</h1>
            <p className={styles.subtitle}>
              Da de alta una comunidad desde cero. Al crearla quedarás asignado como su primer
              administrador.
            </p>
          </div>
        </header>

        <Card className={styles.card}>
          {serverError && (
            <div className={styles.errorWrapper}>
              <Alert variant="error">{serverError}</Alert>
            </div>
          )}

          <form className={styles.form} onSubmit={onSubmit} noValidate>
            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Identidad</h2>
                <p className={styles.sectionHint}>Cómo aparecerá la comunidad en la aplicación.</p>
              </div>

              <Field label="Nombre" htmlFor="name" error={errors.name?.message} required>
                <Input
                  id="name"
                  autoComplete="organization"
                  placeholder="Ej: Comunidad de Propietarios Los Olivos"
                  {...register('name')}
                />
              </Field>

              <Field
                label="Identificador (slug)"
                htmlFor="slug"
                error={errors.slug?.message}
                hint={`Se usa en la dirección: /c/${slugValue || 'mi-comunidad'}`}
                required
              >
                <Input
                  id="slug"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="los-olivos"
                  {...register('slug', {
                    onChange: () => {
                      slugEdited.current = true
                    },
                  })}
                />
              </Field>

              <Field
                label="Descripción"
                htmlFor="description"
                error={errors.description?.message}
                hint="Opcional. Una línea sobre la comunidad que verán sus miembros."
              >
                <Textarea
                  id="description"
                  rows={3}
                  maxLength={2000}
                  placeholder="Ej: Urbanización de 48 viviendas con piscina y pista de pádel."
                  {...register('description')}
                />
              </Field>
            </section>

            <section className={styles.section}>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Ubicación</h2>
                <p className={styles.sectionHint}>
                  Sirve para ordenar y localizar la comunidad en la plataforma.
                </p>
              </div>

              <Field
                label="Dirección"
                htmlFor="addressLine1"
                error={errors.addressLine1?.message}
                required
              >
                <Input
                  id="addressLine1"
                  autoComplete="street-address"
                  placeholder="Calle, número y portal"
                  {...register('addressLine1')}
                />
              </Field>

              <div className={styles.row}>
                <Field label="Ciudad" htmlFor="city" error={errors.city?.message} required>
                  <Input id="city" autoComplete="address-level2" {...register('city')} />
                </Field>
                <Field
                  label="Provincia"
                  htmlFor="province"
                  error={errors.province?.message}
                  required
                >
                  <Input id="province" autoComplete="address-level1" {...register('province')} />
                </Field>
                <Field
                  label="Código postal"
                  htmlFor="postalCode"
                  error={errors.postalCode?.message}
                  required
                >
                  <Input
                    id="postalCode"
                    autoComplete="postal-code"
                    inputMode="numeric"
                    maxLength={5}
                    placeholder="46001"
                    {...register('postalCode')}
                  />
                </Field>
              </div>
            </section>

            <div className={styles.note}>
              <ShieldCheck size={18} aria-hidden="true" className={styles.noteIcon} />
              <p className={styles.noteText}>
                Serás <strong>ADMIN</strong> de esta comunidad. Después podrás invitar a los vecinos
                y nombrar presidente.
              </p>
            </div>

            <div className={styles.formFooter}>
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

      <ConfirmDialog
        open={blocked}
        title="Cambios sin guardar"
        description="Has empezado a crear una comunidad. Si sales ahora, se perderá lo que has escrito."
        confirmLabel="Salir sin guardar"
        cancelLabel="Seguir editando"
        onConfirm={confirm}
        onCancel={cancel}
      />
    </div>
  )
}
