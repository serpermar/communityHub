import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Select,
  SkeletonList,
  Textarea,
  ANNOUNCEMENT_TYPE_TONES,
} from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { isManager } from '@/types/roles'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { useUrlFilters } from '@/hooks/useUrlFilters'
import { formatDateTime } from '@/utils/format'
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  updateAnnouncement,
} from '../api'
import {
  ANNOUNCEMENT_PRIORITIES,
  ANNOUNCEMENT_PRIORITY_LABELS,
  ANNOUNCEMENT_TYPES,
  ANNOUNCEMENT_TYPE_LABELS,
  type Announcement,
} from '../types'

const schema = z.object({
  title: z.string().trim().min(3, 'Mínimo 3 caracteres.').max(120, 'Máximo 120.'),
  body: z.string().trim().min(1, 'El cuerpo es obligatorio.').max(5000, 'Máximo 5000.'),
  type: z.enum(ANNOUNCEMENT_TYPES),
  priority: z.enum(ANNOUNCEMENT_PRIORITIES),
  isPinned: z.boolean(),
  expiresAt: z.string().optional().or(z.literal('')),
})

type FormValues = z.infer<typeof schema>

const toLocalInput = (iso: string | null): string => {
  if (!iso) return ''
  const date = new Date(iso)
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16)
}

export function AnnouncementsPage() {
  const { active, role } = useCommunity()
  const canManage = isManager(role)
  const { filters, page, setFilter, setPage } = useUrlFilters({ type: ANNOUNCEMENT_TYPES })
  const type = filters.type
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Announcement | null>(null)

  const result = useResource(
    () => listAnnouncements(active!.id, { type: (type || undefined) as never, page, limit: 20 }),
    [active?.id, type, page],
  )

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'GENERAL', priority: 'MEDIUM', isPinned: false, expiresAt: '' },
  })

  const openCreate = () => {
    setEditing(null)
    reset({
      title: '',
      body: '',
      type: 'GENERAL',
      priority: 'MEDIUM',
      isPinned: false,
      expiresAt: '',
    })
    setServerError(null)
    setOpen(true)
  }

  const openEdit = (announcement: Announcement) => {
    setEditing(announcement)
    reset({
      title: announcement.title,
      body: announcement.body,
      type: announcement.type,
      priority: announcement.priority,
      isPinned: announcement.isPinned,
      expiresAt: toLocalInput(announcement.expiresAt),
    })
    setServerError(null)
    setOpen(true)
  }

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null)
    const input = {
      title: values.title,
      body: values.body,
      type: values.type,
      priority: values.priority,
      isPinned: values.isPinned,
      publishAt: editing?.publishAt ?? new Date().toISOString(),
      expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : null,
    }
    try {
      if (editing) await updateAnnouncement(editing.id, input)
      else await createAnnouncement(active!.id, input)
      setOpen(false)
      result.reload()
    } catch (caught) {
      setServerError(ApiError.from(caught).message)
    }
  })

  const onDelete = async (announcement: Announcement) => {
    setServerError(null)
    try {
      await deleteAnnouncement(announcement.id)
      setPendingDelete(null)
      result.reload()
    } catch (caught) {
      setServerError(ApiError.from(caught).message)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Avisos"
        actions={canManage && <Button onClick={openCreate}>Nuevo aviso</Button>}
      />

      <Card>
        <Select
          aria-label="Tipo"
          value={type}
          onChange={(event) => setFilter('type', event.target.value)}
          className="sm:w-64"
        >
          <option value="">Todos los tipos</option>
          {ANNOUNCEMENT_TYPES.map((value) => (
            <option key={value} value={value}>
              {ANNOUNCEMENT_TYPE_LABELS[value]}
            </option>
          ))}
        </Select>
      </Card>

      {serverError && <Alert variant="error">{serverError}</Alert>}

      {result.loading ? (
        <SkeletonList />
      ) : result.error ? (
        <ErrorState error={result.error} onRetry={result.reload} />
      ) : result.data && result.data.data.length > 0 ? (
        <>
          <div className="space-y-3">
            {result.data.data.map((announcement) => (
              <Card
                key={announcement.id}
                title={
                  <span className="flex items-center gap-2">
                    {announcement.isPinned && <Badge tone="violet">Fijado</Badge>}
                    <span>{announcement.title}</span>
                    <Badge tone={ANNOUNCEMENT_TYPE_TONES[announcement.type]}>
                      {ANNOUNCEMENT_TYPE_LABELS[announcement.type]}
                    </Badge>
                  </span>
                }
                actions={
                  canManage ? (
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => openEdit(announcement)}>
                        Editar
                      </Button>
                      {role === 'ADMIN' && (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setPendingDelete(announcement)}
                        >
                          Eliminar
                        </Button>
                      )}
                    </div>
                  ) : undefined
                }
              >
                <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">
                  {announcement.body}
                </p>
                <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                  {announcement.authorName ?? 'Comunidad'} ·{' '}
                  {formatDateTime(announcement.publishAt)}
                </p>
              </Card>
            ))}
          </div>
          <Pagination
            page={result.data.meta.page}
            totalPages={result.data.meta.totalPages}
            total={result.data.meta.total}
            onPage={setPage}
          />
        </>
      ) : (
        <EmptyState
          title="No hay avisos"
          description="Publica el primer aviso para la comunidad."
          action={canManage ? <Button onClick={openCreate}>Nuevo aviso</Button> : undefined}
        />
      )}

      <Modal
        open={open}
        title={editing ? 'Editar aviso' : 'Nuevo aviso'}
        onClose={() => setOpen(false)}
      >
        <form className="space-y-3" onSubmit={onSubmit} noValidate>
          <Field label="Título" htmlFor="ann-title" error={errors.title?.message} required>
            <Input id="ann-title" {...register('title')} />
          </Field>
          <Field label="Mensaje" htmlFor="ann-body" error={errors.body?.message} required>
            <Textarea id="ann-body" rows={4} {...register('body')} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tipo" htmlFor="ann-type">
              <Select id="ann-type" {...register('type')}>
                {ANNOUNCEMENT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {ANNOUNCEMENT_TYPE_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Prioridad" htmlFor="ann-priority">
              <Select id="ann-priority" {...register('priority')}>
                {ANNOUNCEMENT_PRIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {ANNOUNCEMENT_PRIORITY_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Caduca (opcional)" htmlFor="ann-expires">
            <Input id="ann-expires" type="datetime-local" {...register('expiresAt')} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" {...register('isPinned')} />
            Fijar en la parte superior
          </label>
          {serverError && <Alert variant="error">{serverError}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Guardar
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Eliminar aviso"
        description={pendingDelete ? `Se eliminará el aviso «${pendingDelete.title}».` : undefined}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => (pendingDelete ? onDelete(pendingDelete) : undefined)}
      />
    </div>
  )
}
