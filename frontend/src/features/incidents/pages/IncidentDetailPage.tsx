import { useCallback, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  LoadingState,
  ErrorState,
  Textarea,
} from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useAuth } from '@/context/AuthContext'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { formatDateTime } from '@/utils/format'
import { addComment, getIncident, listComments, transitionIncident } from '../api'
import { commentSchema, type CommentForm } from '../schemas'
import { CATEGORY_LABELS, PRIORITY_LABELS, STATUS_LABELS, type IncidentStatus } from '../types'

function nextStatuses(
  status: IncidentStatus,
  role: string | null,
  isAssigned: boolean,
): IncidentStatus[] {
  const admin = role === 'ADMIN'
  const assignedProvider = role === 'PROVIDER' && isAssigned
  const options: IncidentStatus[] = []
  if ((admin || assignedProvider) && status === 'OPEN') options.push('IN_PROGRESS')
  if ((admin || assignedProvider) && status === 'IN_PROGRESS') options.push('RESOLVED')
  if (admin && status === 'RESOLVED') options.push('OPEN')
  if (admin && (status === 'OPEN' || status === 'IN_PROGRESS' || status === 'RESOLVED')) {
    options.push('CANCELLED')
  }
  return options
}

export function IncidentDetailPage() {
  const { incidentId } = useParams<{ incidentId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { active, role } = useCommunity()
  const [actionError, setActionError] = useState<string | null>(null)

  const incident = useResource(() => getIncident(incidentId!), [incidentId])
  const comments = useResource(() => listComments(incidentId!), [incidentId])

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CommentForm>({ resolver: zodResolver(commentSchema) })

  const onTransition = useCallback(
    async (status: IncidentStatus) => {
      setActionError(null)
      try {
        await transitionIncident(incidentId!, status)
        incident.reload()
      } catch (caught) {
        setActionError(ApiError.from(caught).message)
      }
    },
    [incidentId, incident],
  )

  const onComment = handleSubmit(async (values) => {
    try {
      await addComment(incidentId!, values.body)
      reset({ body: '' })
      comments.reload()
    } catch (caught) {
      setActionError(ApiError.from(caught).message)
    }
  })

  if (incident.loading) return <LoadingState />
  if (incident.error) return <ErrorState error={incident.error} onRetry={incident.reload} />
  if (!incident.data) return null

  const item = incident.data
  const targets = nextStatuses(item.status, role, item.assignedToId === user?.id)

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <button
        type="button"
        onClick={() => navigate(`/c/${active!.id}/incidents`)}
        className="text-sm text-slate-500 hover:text-brand-700"
      >
        ← Volver a incidencias
      </button>

      <Card>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-slate-400">{item.referenceCode}</p>
            <h1 className="text-lg font-semibold text-slate-800">{item.title}</h1>
          </div>
          <Badge tone={item.status === 'RESOLVED' ? 'green' : 'blue'}>
            {STATUS_LABELS[item.status]}
          </Badge>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-slate-400">Categoría</dt>
            <dd className="text-slate-700">{CATEGORY_LABELS[item.category]}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Prioridad</dt>
            <dd className="text-slate-700">{PRIORITY_LABELS[item.priority]}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Reportada por</dt>
            <dd className="text-slate-700">{item.reporterName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Asignada a</dt>
            <dd className="text-slate-700">{item.assignedToName ?? 'Sin asignar'}</dd>
          </div>
        </dl>

        {item.location && <p className="mt-3 text-sm text-slate-600">Ubicación: {item.location}</p>}
        <p className="mt-4 whitespace-pre-wrap text-sm text-slate-700">{item.description}</p>
        <p className="mt-3 text-xs text-slate-400">Creada el {formatDateTime(item.createdAt)}</p>
      </Card>

      {actionError && <Alert variant="error">{actionError}</Alert>}

      {targets.length > 0 && (
        <Card title="Cambiar estado">
          <div className="flex flex-wrap gap-2">
            {targets.map((target) => (
              <Button key={target} variant="secondary" onClick={() => void onTransition(target)}>
                {STATUS_LABELS[target]}
              </Button>
            ))}
          </div>
        </Card>
      )}

      <Card title="Comentarios">
        {comments.loading ? (
          <LoadingState />
        ) : comments.data && comments.data.length > 0 ? (
          <ul className="space-y-3">
            {comments.data.map((comment) => (
              <li key={comment.id} className="rounded-md bg-slate-50 p-3">
                <p className="text-xs text-slate-400">
                  {comment.authorName ?? 'Usuario'} · {formatDateTime(comment.createdAt)}
                </p>
                <p className="mt-1 text-sm text-slate-700">{comment.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">Todavía no hay comentarios.</p>
        )}

        <form className="mt-4 space-y-2" onSubmit={onComment} noValidate>
          <Field label="Añadir comentario" htmlFor="body" error={errors.body?.message}>
            <Textarea id="body" rows={2} {...register('body')} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" size="sm" loading={isSubmitting}>
              Comentar
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
