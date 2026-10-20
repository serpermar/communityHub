import { useState } from 'react'
import { Button } from './Button'
import { Modal } from './Display'

/**
 * Confirmación destructiva sobre el `Modal` accesible (FE-18). Sustituye al
 * `window.confirm` y a los diálogos ad-hoc, para que "Eliminar" tenga el mismo
 * aspecto, el mismo foco atrapado y el mismo texto en toda la app.
 *
 * El patrón es controlado: quien lo usa decide cuándo es verdad `open` y qué
 * hacer en `onConfirm` (normalmente una promesa; mientras corre, el botón queda
 * en `loading`).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Eliminar',
  cancelLabel = 'Cancelar',
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}) {
  const [busy, setBusy] = useState(false)

  const handleConfirm = async () => {
    try {
      setBusy(true)
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      onClose={busy ? () => {} : onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant="danger" onClick={() => void handleConfirm()} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description && <p className="text-sm text-slate-600 dark:text-slate-300">{description}</p>}
    </Modal>
  )
}
