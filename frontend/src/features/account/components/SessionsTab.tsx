import { useState } from 'react'
import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  ErrorState,
  LoadingState,
  useToast,
} from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useResource } from '@/hooks/useResource'
import { formatDateTime } from '@/utils/format'
import type { SessionView } from '@/types/auth'
import { listSessions, revokeOtherSessions, revokeSession } from '../api'
import styles from './SessionsTab.module.css'

export function SessionsTab() {
  const { notify } = useToast()
  const sessions = useResource(() => listSessions(), [])
  const [error, setError] = useState<string | null>(null)
  const [revokeOthersOpen, setRevokeOthersOpen] = useState(false)

  const revoke = async (session: SessionView) => {
    setError(null)
    try {
      await revokeSession(session.id)
      sessions.reload()
    } catch (caught) {
      setError(ApiError.from(caught).message)
    }
  }

  const revokeOthers = async () => {
    setError(null)
    try {
      await revokeOtherSessions()
      sessions.reload()
      notify('Otras sesiones cerradas.', 'success')
    } catch (caught) {
      setError(ApiError.from(caught).message)
    } finally {
      setRevokeOthersOpen(false)
    }
  }

  const columns = [
    {
      key: 'device',
      header: 'Dispositivo',
      render: (row: SessionView) => <span>{row.userAgent ?? 'Desconocido'}</span>,
    },
    { key: 'ip', header: 'IP', render: (row: SessionView) => row.ipAddress ?? '—' },
    {
      key: 'created',
      header: 'Iniciada',
      render: (row: SessionView) => formatDateTime(row.createdAt),
    },
    {
      key: 'lastUsed',
      header: 'Última actividad',
      render: (row: SessionView) => (row.lastUsedAt ? formatDateTime(row.lastUsedAt) : '—'),
    },
    {
      key: 'actions',
      header: '',
      render: (row: SessionView) =>
        row.current ? null : (
          <div className={styles.actionsRight}>
            <Button size="sm" variant="danger" onClick={() => void revoke(row)}>
              Cerrar
            </Button>
          </div>
        ),
    },
  ]

  return (
    <>
      <Card
        title={sessions.data ? `Sesiones activas (${sessions.data.length})` : 'Sesiones activas'}
        actions={
          sessions.data?.some((s) => !s.current) ? (
            <Button size="sm" variant="ghost" onClick={() => setRevokeOthersOpen(true)}>
              Cerrar todas las demás
            </Button>
          ) : null
        }
      >
        {error && (
          <div style={{ marginBottom: '0.75rem' }}>
            <Alert variant="error">{error}</Alert>
          </div>
        )}
        {sessions.loading ? (
          <LoadingState />
        ) : sessions.error ? (
          <ErrorState error={sessions.error} onRetry={sessions.reload} />
        ) : sessions.data ? (
          <DataTable
            columns={columns}
            rows={sessions.data}
            rowKey={(row) => row.id}
            empty={<p className={styles.emptyText}>No hay sesiones.</p>}
          />
        ) : null}
      </Card>

      <ConfirmDialog
        open={revokeOthersOpen}
        title="Cerrar todas las demás sesiones"
        description="Se cerrarán todas las sesiones excepto la actual. ¿Continuar?"
        confirmLabel="Cerrar demás sesiones"
        onCancel={() => setRevokeOthersOpen(false)}
        onConfirm={() => void revokeOthers()}
      />
    </>
  )
}
