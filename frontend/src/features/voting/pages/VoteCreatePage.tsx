import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Field, Input, Select, Textarea } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useCommunity } from '@/context/CommunityContext'
import { createVote } from '../api'
import {
  VOTE_RESULT_VISIBILITIES,
  VOTE_RESULT_VISIBILITY_LABELS,
  VOTE_TYPES,
  VOTE_TYPE_LABELS,
  type VoteResultVisibility,
  type VoteType,
} from '../types'

const toInput = (date: Date): string => {
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16)
}

export function VoteCreatePage() {
  const navigate = useNavigate()
  const { active } = useCommunity()
  const [title, setTitle] = useState('')
  const [question, setQuestion] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<VoteType>('SINGLE')
  const [startsAt, setStartsAt] = useState(toInput(new Date()))
  const [endsAt, setEndsAt] = useState(toInput(new Date(Date.now() + 7 * 86400000)))
  const [allowAbstention, setAllowAbstention] = useState(true)
  const [quorumPercent, setQuorumPercent] = useState('50')
  const [resultVisibility, setResultVisibility] = useState<VoteResultVisibility>('AFTER_CLOSE')
  const [options, setOptions] = useState<string[]>(['', ''])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const setOption = (index: number, value: string) =>
    setOptions((current) => current.map((item, i) => (i === index ? value : item)))

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    const clean = options.map((option) => option.trim()).filter(Boolean)
    if (clean.length < 2) {
      setError('Debes indicar al menos dos opciones.')
      return
    }
    setSaving(true)
    try {
      const vote = await createVote(active!.id, {
        title: title.trim(),
        question: question.trim(),
        description: description.trim() || undefined,
        type,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        allowAbstention,
        quorumPercent: type === 'QUORUM' ? Number(quorumPercent) : undefined,
        resultVisibility,
        options: clean,
      })
      navigate(`/c/${active!.id}/votes/${vote.id}`, { replace: true })
    } catch (caught) {
      setError(ApiError.from(caught).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold text-slate-800">Nueva votación</h1>
      <Card className="mt-4">
        {error && (
          <div className="mb-4">
            <Alert variant="error">{error}</Alert>
          </div>
        )}
        <form className="space-y-3" onSubmit={onSubmit} noValidate>
          <Field label="Título" htmlFor="vote-title" required>
            <Input id="vote-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Pregunta" htmlFor="vote-question" required>
            <Input
              id="vote-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </Field>
          <Field label="Descripción" htmlFor="vote-description">
            <Textarea
              id="vote-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tipo" htmlFor="vote-type">
              <Select
                id="vote-type"
                value={type}
                onChange={(e) => setType(e.target.value as VoteType)}
              >
                {VOTE_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {VOTE_TYPE_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Visibilidad de resultados" htmlFor="vote-visibility">
              <Select
                id="vote-visibility"
                value={resultVisibility}
                onChange={(e) => setResultVisibility(e.target.value as VoteResultVisibility)}
              >
                {VOTE_RESULT_VISIBILITIES.map((value) => (
                  <option key={value} value={value}>
                    {VOTE_RESULT_VISIBILITY_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Inicio" htmlFor="vote-start" required>
              <Input
                id="vote-start"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </Field>
            <Field label="Fin" htmlFor="vote-end" required>
              <Input
                id="vote-end"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </Field>
          </div>
          {type === 'QUORUM' && (
            <Field label="Quórum requerido (%)" htmlFor="vote-quorum">
              <Input
                id="vote-quorum"
                type="number"
                min={1}
                max={100}
                value={quorumPercent}
                onChange={(e) => setQuorumPercent(e.target.value)}
              />
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={allowAbstention}
              onChange={(e) => setAllowAbstention(e.target.checked)}
            />
            Permitir abstención
          </label>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700">Opciones</legend>
            {options.map((option, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  aria-label={`Opción ${index + 1}`}
                  value={option}
                  onChange={(e) => setOption(index, e.target.value)}
                />
                {options.length > 2 && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
                  >
                    Quitar
                  </Button>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setOptions((current) => [...current, ''])}
            >
              Añadir opción
            </Button>
          </fieldset>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving}>
              Crear votación
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
