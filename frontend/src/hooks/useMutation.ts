import { useCallback, useState } from 'react'
import { ApiError } from '@/services/ApiError'

export interface MutationState<TArgs extends unknown[], TResult> {
  run: (...args: TArgs) => Promise<TResult>
  pending: boolean
  error: ApiError | null
  reset: () => void
}

/** Envuelve una accion de escritura con `pending` y error normalizado. */
export function useMutation<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
): MutationState<TArgs, TResult> {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const run = useCallback(
    async (...args: TArgs) => {
      setPending(true)
      setError(null)
      try {
        return await action(...args)
      } catch (caught) {
        const normalized = ApiError.from(caught)
        setError(normalized)
        throw normalized
      } finally {
        setPending(false)
      }
    },
    [action],
  )

  const reset = useCallback(() => setError(null), [])

  return { run, pending, error, reset }
}
