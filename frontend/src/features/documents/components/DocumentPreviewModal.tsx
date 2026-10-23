import { useEffect, useState } from 'react'
import { Button, Modal, Spinner } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { getDownloadUrl } from '../api'
import type { CommunityDocument } from '../types'

function isPreviewable(mimeType: string): boolean {
  return mimeType.startsWith('image/') || mimeType === 'application/pdf'
}

export function DocumentPreviewModal({
  document,
  open,
  onClose,
}: {
  document: CommunityDocument | null
  open: boolean
  onClose: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !document) {
      setUrl(null)
      setError(null)
      setLoading(false)
      return
    }
    if (!isPreviewable(document.mimeType)) {
      setUrl(null)
      setError('Este tipo de archivo no admite vista previa.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    getDownloadUrl(document.id)
      .then((res) => setUrl(res.url))
      .catch((caught) => setError(ApiError.from(caught).message))
      .finally(() => setLoading(false))
  }, [open, document])

  const isPdf = document?.mimeType === 'application/pdf'
  const isImage = document?.mimeType.startsWith('image/')

  return (
    <Modal open={open} title={document?.title ?? 'Vista previa'} onClose={onClose}>
      <div className="space-y-3">
        {loading && (
          <div className="flex h-80 items-center justify-center">
            <Spinner />
          </div>
        )}
        {!loading && error && <p className="text-sm text-danger-600">{error}</p>}
        {!loading && url && isImage && (
          <div className="flex max-h-[70vh] items-center justify-center overflow-auto">
            <img src={url} alt={document?.title} className="max-h-[70vh] max-w-full object-contain" />
          </div>
        )}
        {!loading && url && isPdf && (
          <iframe
            src={url}
            title={document?.title ?? 'Documento PDF'}
            className="h-[70vh] w-full rounded-card border border-slate-200 dark:border-slate-800"
          />
        )}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export { isPreviewable }
