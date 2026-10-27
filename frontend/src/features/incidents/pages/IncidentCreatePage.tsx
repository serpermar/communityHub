import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
  useToast,
} from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useCommunity } from '@/context/CommunityContext'
import { t } from '@/i18n'
import { createIncidentDraft, confirmIncidentDraft } from '@/features/assistant/api'
import type { IncidentProposal } from '@/features/assistant/types'
import { createIncident } from '../api'
import { createIncidentSchema, type CreateIncidentForm } from '../schemas'
import {
  CATEGORY_LABELS,
  INCIDENT_CATEGORIES,
  INCIDENT_PRIORITIES,
  PRIORITY_LABELS,
  type IncidentCategory,
  type IncidentPriority,
} from '../types'
import styles from './IncidentCreatePage.module.css'

export function IncidentCreatePage() {
  const { active } = useCommunity()
  const navigate = useNavigate()
  const { notify } = useToast()
  const [serverError, setServerError] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [proposal, setProposal] = useState<IncidentProposal | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateIncidentForm>({
    resolver: zodResolver(createIncidentSchema),
    defaultValues: { category: 'OTHER', priority: 'MEDIUM' },
  })

  const analyze = async () => {
    const text = description.trim()
    if (text.length < 10) {
      setServerError('Describe el problema con un poco más de detalle antes de analizar.')
      return
    }
    setServerError(null)
    setAnalyzing(true)
    try {
      const draft = await createIncidentDraft(active!.id, text)
      setDraftId(draft.id)
      setProposal(draft.proposal)
      setValue('title', draft.proposal.title)
      setValue('description', draft.proposal.description)
      setValue('category', draft.proposal.category as IncidentCategory)
      setValue('priority', draft.proposal.priority as IncidentPriority)
      notify('Propuesta de la IA lista para revisar.', 'success')
    } catch (caught) {
      setServerError(ApiError.from(caught).message)
    } finally {
      setAnalyzing(false)
    }
  }

  const discardDraft = () => {
    setDraftId(null)
    setProposal(null)
  }

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null)
    try {
      const created = draftId
        ? await confirmIncidentDraft(draftId, {
            title: values.title,
            description: values.description,
            category: values.category,
            priority: values.priority,
            location: values.location || undefined,
          })
        : await createIncident(active!.id, {
            title: values.title,
            description: values.description,
            category: values.category,
            priority: values.priority,
            location: values.location || null,
          })
      notify(t('toast.created'), 'success')
      navigate(`/c/${active!.id}/incidents/${created.id}`, { replace: true })
    } catch (caught) {
      setServerError(ApiError.from(caught).message)
    }
  })

  return (
    <div className={styles.page}>
      <PageHeader title="Nueva incidencia" />

      <Card title="Asistente IA (opcional)">
        <p className={styles.aiHint}>
          Describe el problema en tus palabras y la IA propondrá título, categoría y prioridad. Tú
          revisas y ajustas antes de crear la incidencia.
        </p>
        <Textarea
          aria-label="Descripción para la IA"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Ej.: El ascensor del portal B lleva dos días parado entre la planta 1 y la 2."
        />
        <div className={styles.aiActions}>
          {draftId ? (
            <>
              <Badge tone="violet">Borrador IA</Badge>
              <div className={styles.aiActionsRight}>
                <Button variant="ghost" size="sm" onClick={discardDraft}>
                  Descartar
                </Button>
                <Button size="sm" loading={analyzing} onClick={() => void analyze()}>
                  Volver a analizar
                </Button>
              </div>
            </>
          ) : (
            <Button
              className={styles.aiActionsEnd}
              variant="secondary"
              loading={analyzing}
              onClick={() => void analyze()}
            >
              Analizar con IA
            </Button>
          )}
        </div>

        {proposal && (
          <div className={styles.proposal}>
            <div className={styles.proposalBadges}>
              <Badge tone="violet">{CATEGORY_LABELS[proposal.category as IncidentCategory]}</Badge>
              <Badge tone="amber">{PRIORITY_LABELS[proposal.priority as IncidentPriority]}</Badge>
              <span className={styles.proposalConfidence}>
                Confianza {Math.round(proposal.confidence * 100)}%
              </span>
              {proposal.needsHumanReview && <Badge tone="red">Requiere revisión humana</Badge>}
            </div>
            <p className={styles.proposalTitle}>{proposal.title}</p>
          </div>
        )}
      </Card>

      <Card>
        {serverError && (
          <div className={styles.errorWrapper}>
            <Alert variant="error">{serverError}</Alert>
          </div>
        )}
        <form className={styles.form} onSubmit={onSubmit} noValidate>
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
          <div className={styles.formRow}>
            <Field label="Categoría" htmlFor="category" error={errors.category?.message}>
              <Select id="category" {...register('category')} value={watch('category') ?? 'OTHER'}>
                {INCIDENT_CATEGORIES.flatMap((value) => (
                  <option key={value} value={value}>
                    {CATEGORY_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Prioridad" htmlFor="priority" error={errors.priority?.message}>
              <Select id="priority" {...register('priority')} value={watch('priority') ?? 'MEDIUM'}>
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
          <div className={styles.formFooter}>
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              Cancelar
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {draftId ? 'Confirmar incidencia' : 'Crear incidencia'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
