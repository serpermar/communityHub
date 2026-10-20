import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from 'react-router-dom'
import { z } from 'zod'
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  Select,
  SkeletonList,
  type Column,
} from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { createCommonArea, listCommonAreas } from '../api'
import { COMMON_AREA_TYPES, COMMON_AREA_TYPE_LABELS, type CommonArea } from '../types'

const createAreaSchema = z.object({
  name: z.string().trim().min(2, 'El nombre es obligatorio.').max(120),
  type: z.enum(COMMON_AREA_TYPES),
  slotMinutes: z.coerce
    .number()
    .int()
    .refine((value) => [30, 60, 90, 120].includes(value), {
      message: 'La rejilla debe ser 30, 60, 90 o 120 minutos.',
    }),
  requiresApproval: z.boolean(),
})

type CreateAreaForm = z.infer<typeof createAreaSchema>

export function CommonAreaListPage() {
  const { active, role } = useCommunity()
  const [open, setOpen] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const areas = useResource(() => listCommonAreas(active!.id), [active?.id])

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateAreaForm>({
    resolver: zodResolver(createAreaSchema),
    defaultValues: { type: 'OTHER', slotMinutes: 60, requiresApproval: false },
  })

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null)
    try {
      await createCommonArea(active!.id, {
        name: values.name,
        type: values.type,
        description: null,
        capacity: null,
        slotMinutes: values.slotMinutes,
        openTime: '08:00',
        closeTime: '22:00',
        maxDailyReservations: null,
        requiresApproval: values.requiresApproval,
        isActive: true,
      })
      reset({ type: 'OTHER', slotMinutes: 60, requiresApproval: false, name: '' })
      setOpen(false)
      areas.reload()
    } catch (caught) {
      setServerError(ApiError.from(caught).message)
    }
  })

  const columns: Column<CommonArea>[] = [
    {
      key: 'name',
      header: 'Zona',
      render: (area) => (
        <Link
          to={`/c/${active!.id}/common-areas/${area.id}`}
          className="font-medium text-brand-700 dark:text-brand-400 hover:underline"
        >
          {area.name}
        </Link>
      ),
    },
    { key: 'type', header: 'Tipo', render: (area) => COMMON_AREA_TYPE_LABELS[area.type] },
    { key: 'slot', header: 'Franja', render: (area) => `${area.slotMinutes} min` },
    {
      key: 'approval',
      header: 'Aprobación',
      render: (area) => (area.requiresApproval ? 'Sí' : 'No'),
    },
    {
      key: 'state',
      header: 'Estado',
      render: (area) => (
        <Badge tone={area.isActive ? 'green' : 'slate'}>{area.isActive ? 'Activa' : 'Baja'}</Badge>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Zonas comunes</h1>
        {role === 'ADMIN' && <Button onClick={() => setOpen(true)}>Nueva zona</Button>}
      </div>

      {areas.loading ? (
        <SkeletonList />
      ) : areas.error ? (
        <ErrorState error={areas.error} onRetry={areas.reload} />
      ) : areas.data ? (
        <Card>
          <DataTable
            columns={columns}
            rows={areas.data}
            rowKey={(area) => area.id}
            empty={<EmptyState title="No hay zonas comunes" />}
          />
        </Card>
      ) : null}

      <Modal open={open} title="Nueva zona común" onClose={() => setOpen(false)}>
        {serverError && (
          <div className="mb-3">
            <Alert variant="error">{serverError}</Alert>
          </div>
        )}
        <form className="space-y-3" onSubmit={onSubmit} noValidate>
          <Field label="Nombre" htmlFor="area-name" error={errors.name?.message} required>
            <Input id="area-name" {...register('name')} />
          </Field>
          <Field label="Tipo" htmlFor="area-type" error={errors.type?.message}>
            <Select id="area-type" {...register('type')}>
              {COMMON_AREA_TYPES.map((value) => (
                <option key={value} value={value}>
                  {COMMON_AREA_TYPE_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Franja (minutos)" htmlFor="slotMinutes" error={errors.slotMinutes?.message}>
            <Input id="slotMinutes" type="number" step={30} {...register('slotMinutes')} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" {...register('requiresApproval')} />
            Requiere aprobación del administrador
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Crear
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
