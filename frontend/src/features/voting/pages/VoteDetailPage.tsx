import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert,
  Badge,
  Button,
  Card,
  ErrorState,
  PageHeader,
  SkeletonDetail,
  SkeletonList,
  VOTE_STATUS_TONES,
} from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { isManager } from '@/types/roles'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { formatDateTime } from '@/utils/format'
import {
  castVote,
  closeVote,
  downloadResultsCsv,
  getVote,
  getVoteResults,
  publishVote,
} from '../api'
import { VOTE_STATUS_LABELS } from '../types'

export function VoteDetailPage() {
  const { voteId } = useParams<{ voteId: string }>()
  const navigate = useNavigate()
  const { active, role } = useCommunity()
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const vote = useResource(() => getVote(voteId!), [voteId])
  const results = useResource(() => getVoteResults(voteId!), [voteId])

  const run = async (action: () => Promise<unknown>) => {
    setError(null)
    setBusy(true)
    try {
      await action()
      vote.reload()
      results.reload()
    } catch (caught) {
      setError(ApiError.from(caught).message)
    } finally {
      setBusy(false)
    }
  }

  if (vote.loading) return <SkeletonDetail />
  if (vote.error) return <ErrorState error={vote.error} onRetry={vote.reload} />
  if (!vote.data) return null

  const item = vote.data
  const canVote = item.effectiveStatus === 'OPEN' && role !== 'PROVIDER'
  const manager = isManager(role)

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <button
        type="button"
        onClick={() => navigate(`/c/${active!.id}/votes`)}
        className="text-sm text-slate-500 dark:text-slate-400 hover:text-brand-700 dark:hover:text-brand-400"
      >
        ← Volver a votaciones
      </button>

      <PageHeader
        title={item.title}
        actions={
          <Badge tone={VOTE_STATUS_TONES[item.effectiveStatus]}>
            {VOTE_STATUS_LABELS[item.effectiveStatus]}
          </Badge>
        }
      />

      <Card>
        <p className="text-sm text-slate-700 dark:text-slate-200">{item.question}</p>
        {item.description && (
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
            {item.description}
          </p>
        )}
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
          Cierra el {formatDateTime(item.endsAt)}
        </p>

        {error && (
          <div className="mt-3">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        <fieldset className="mt-4 space-y-2">
          <legend className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Opciones
          </legend>
          {item.options.map((option) => (
            <label
              key={option.id}
              className="flex items-center gap-2 rounded-md border border-slate-200 dark:border-slate-800 px-3 py-2 text-sm"
            >
              <input
                type="radio"
                name="vote-option"
                value={option.id}
                disabled={!canVote}
                checked={selected ? selected === option.id : item.myOptionId === option.id}
                onChange={() => setSelected(option.id)}
              />
              <span>{option.label}</span>
              {item.myOptionId === option.id && <Badge tone="blue">Tu voto</Badge>}
            </label>
          ))}
        </fieldset>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {manager && item.effectiveStatus === 'DRAFT' && (
            <Button loading={busy} onClick={() => void run(() => publishVote(item.id))}>
              Publicar
            </Button>
          )}
          {manager && item.effectiveStatus === 'OPEN' && (
            <Button
              variant="secondary"
              loading={busy}
              onClick={() => void run(() => closeVote(item.id))}
            >
              Cerrar votación
            </Button>
          )}
          {canVote && (
            <Button
              loading={busy}
              disabled={!selected && !item.myOptionId}
              onClick={() => void run(() => castVote(item.id, selected ?? item.myOptionId!))}
            >
              {item.myOptionId ? 'Cambiar voto' : 'Votar'}
            </Button>
          )}
        </div>
      </Card>

      <Card
        title="Resultados"
        actions={
          results.data ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void downloadResultsCsv(item.id)
                  .then((blob) => {
                    const url = URL.createObjectURL(blob)
                    const link = document.createElement('a')
                    link.href = url
                    link.download = 'resultados.csv'
                    link.click()
                    URL.revokeObjectURL(url)
                  })
                  .catch((caught) => setError(ApiError.from(caught).message))
              }
            >
              Exportar CSV
            </Button>
          ) : undefined
        }
      >
        {results.loading ? (
          <SkeletonList rows={2} />
        ) : results.data ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Participación: {results.data.turnout} de {results.data.eligibleCount} (
              {results.data.participationPercent.toFixed(1)}%)
              {results.data.quorumRequired &&
                ` · Quórum ${results.data.quorumPercent}% ${
                  results.data.quorumMet ? 'alcanzado' : 'no alcanzado'
                }`}
            </p>
            {results.data.options.map((option) => (
              <div key={option.id}>
                <div className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200">
                  <span>{option.label}</span>
                  <span>
                    {option.votes} ({option.percent.toFixed(1)}%)
                  </span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    className="h-2 rounded-full bg-brand-500"
                    style={{ width: `${option.percent}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Los resultados no están disponibles todavía.
          </p>
        )}
      </Card>
    </div>
  )
}
