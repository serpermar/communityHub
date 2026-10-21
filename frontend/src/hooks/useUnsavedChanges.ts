import { useContext, useEffect } from 'react'
import { UNSAFE_DataRouterContext as DataRouterContext, useBlocker } from 'react-router-dom'

/**
 * Protege un formulario con cambios sin guardar (FE-26).
 *
 * - En navegacion interna (react-router) bloquea el paso y expone `blocked` para
 *   que la pagina muestre un `ConfirmDialog`; `confirm` deja continuar y `cancel`
 *   se queda en la pagina.
 * - En cierre/recarga de pestana usa `beforeunload`, que es lo unico que el
 *   navegador admite.
 *
 * `isDirty` debe ser un booleano estable (p. ej. `formState.isDirty` de
 * react-hook-form); mientras sea `false` el hook es inerte.
 */
export function useUnsavedChanges(isDirty: boolean) {
  // `useBlocker` exige un data router (`createBrowserRouter`). Si la pagina se
  // monta dentro de un `MemoryRouter` corriente (como en los tests) solo
  // aplicamos el aviso de `beforeunload`, sin romper el arbol.
  const hasDataRouter = useContext(DataRouterContext) != null
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const blocker = hasDataRouter ? useBlocker(isDirty) : undefined

  useEffect(() => {
    if (!isDirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])

  return {
    blocked: blocker?.state === 'blocked',
    confirm: () => {
      if (blocker?.state === 'blocked') blocker.proceed()
    },
    cancel: () => {
      if (blocker?.state === 'blocked') blocker.reset()
    },
  }
}
