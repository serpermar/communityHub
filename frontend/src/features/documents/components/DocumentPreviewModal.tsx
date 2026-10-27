import { useEffect, useState } from 'react'
import { Button, Modal, Spinner } from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { getDownloadUrl } from '../api'
import type { CommunityDocument } from '../types'
import styles from './DocumentPreviewModal.module.css'

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
      <div className={styles.content}>
        {loading && (
          <div className={styles.loadingWrapper}>
            <Spinner />
          </div>
        )}
        {!loading && error && <p className={styles.errorText}>{error}</p>}
        {!loading && url && isImage && (
          <div className={styles.imageWrapper}>
            <img src={url} alt={document?.title} className={styles.image} />
          </div>
        )}
        {!loading && url && isPdf && (
          <iframe
            src={url}
            title={document?.title ?? 'Documento PDF'}
            className={styles.pdfFrame}
          />
        )}
        <div className={styles.footer}>
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export { isPreviewable }
