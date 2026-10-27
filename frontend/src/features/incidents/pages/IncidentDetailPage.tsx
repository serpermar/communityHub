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
  SkeletonDetail,
  ErrorState,
  Textarea,
  INCIDENT_STATUS_TONES,
  ConfirmDialog,
} from '@/components/ui'
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges'
import { ApiError } from '@/services/ApiError'
import { useAuth } from '@/context/AuthContext'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { formatDateTime } from '@/utils/format'
import { addComment, getIncident, listComments, transitionIncident } from '../api'
import { commentSchema, type CommentForm } from '../schemas'
import { CATEGORY_LABELS, PRIORITY_LABELS, STATUS_LABELS, type IncidentStatus } from '../types'
import styles from './IncidentDetailPage.module.css'

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
    formState: { errors, isDirty },
  } = useForm<CommentForm>({ resolver: zodResolver(commentSchema) })

  const [isSubmitting, setIsSubmitting] = useState(false)
  void setIsSubmitting
  const { blocked, confirm, cancel } = useUnsavedChanges(isDirty)

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

  if (incident.loading) return <SkeletonDetail />
  if (incident.error) return <ErrorState error={incident.error} onRetry={incident.reload} />
  if (!incident.data) return null

  const item = incident.data
  const targets = nextStatuses(item.status, role, item.assignedToId === user?.id)

  return (
    <div className={styles.page}>
      <button
        type="button"
        onClick={() => navigate(`/c/${active!.id}/incidents`)}
        className={styles.backButton}
      >
        ← Volver a incidencias
      </button>

      <Card>
        <div className={styles.header}>
          <div>
            <p className={styles.refCode}>{item.referenceCode}</p>
            <h1 className={styles.title}>{item.title}</h1>
          </div>
          <Badge tone={INCIDENT_STATUS_TONES[item.status]}>{STATUS_LABELS[item.status]}</Badge>
        </div>

        <dl className={styles.meta}>
          <div>
            <dt className={styles.metaLabel}>Categoría</dt>
            <dd className={styles.metaValue}>{CATEGORY_LABELS[item.category]}</dd>
          </div>
          <div>
            <dt className={styles.metaLabel}>Prioridad</dt>
            <dd className={styles.metaValue}>{PRIORITY_LABELS[item.priority]}</dd>
          </div>
          <div>
            <dt className={styles.metaLabel}>Reportada por</dt>
            <dd className={styles.metaValue}>{item.reporterName ?? '—'}</dd>
          </div>
          <div>
            <dt className={styles.metaLabel}>Asignada a</dt>
            <dd className={styles.metaValue}>{item.assignedToName ?? 'Sin asignar'}</dd>
          </div>
        </dl>

        {item.location && <p className={styles.location}>Ubicación: {item.location}</p>}
        <p className={styles.description}>{item.description}</p>
        <p className={styles.createdAt}>Creada el {formatDateTime(item.createdAt)}</p>
      </Card>

      {actionError && <Alert variant="error">{actionError}</Alert>}

      {targets.length > 0 && (
        <Card title="Cambiar estado">
          <div className={styles.transitionActions}>
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
          <ul className={styles.commentList}>
            {comments.data.map((comment) => (
              <li key={comment.id} className={styles.commentItem}>
                <p className={styles.commentMeta}>
                  {comment.authorName ?? 'Usuario'} · {formatDateTime(comment.createdAt)}
                </p>
                <p className={styles.commentBody}>{comment.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.emptyComments}>Todavía no hay comentarios.</p>
        )}

        <form className={styles.commentForm} onSubmit={onComment} noValidate>
          <Field label="Añadir comentario" htmlFor="body" error={errors.body?.message}>
            <Textarea id="body" rows={2} {...register('body')} />
          </Field>
          <div className={styles.commentFooter}>
            <Button type="submit" size="sm" loading={isSubmitting}>
              Comentar
            </Button>
          </div>
        </form>
      </Card>

      <ConfirmDialog
        open={blocked}
        title="Cambios sin guardar"
        description="Tienes un comentario sin enviar. ¿Quieres descartar los cambios y salir?"
        confirmLabel="Salir sin guardar"
        cancelLabel="Seguir editando"
        onConfirm={confirm}
        onCancel={cancel}
      />
    </div>
  )
}
