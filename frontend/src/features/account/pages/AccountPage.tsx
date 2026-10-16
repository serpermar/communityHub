import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  ErrorState,
  LoadingState,
  type Column,
} from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useAuth } from '@/context/AuthContext'
import { useResource } from '@/hooks/useResource'
import { formatDateTime } from '@/utils/format'
import type { SessionView } from '@/types/auth'
import { listSessions, revokeSession } from '../api'

export function AccountPage() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const sessions = useResource(() => listSessions(), [])

  const revoke = async (session: SessionView) => {
    setError(null)
    try {
      await revokeSession(session.id)
      sessions.reload()
    } catch (caught) {
      setError(ApiError.from(caught).message)
    }
  }

  const columns: Column<SessionView>[] = [
    {
      key: 'device',
      header: 'Dispositivo',
      render: (row) => (
        <span>
          {row.userAgent ?? 'Desconocido'}
          {row.current && (
            <Badge tone="green" className="ml-2">
              Actual
            </Badge>
          )}
        </span>
      ),
    },
    { key: 'ip', header: 'IP', render: (row) => row.ipAddress ?? '—' },
    {
      key: 'lastUsed',
      header: 'Última actividad',
      render: (row) => (row.lastUsedAt ? formatDateTime(row.lastUsedAt) : '—'),
    },
    {
      key: 'actions',
      header: '',
      render: (row) =>
        row.current ? null : (
          <div className="flex justify-end">
            <Button size="sm" variant="danger" onClick={() => void revoke(row)}>
              Cerrar
            </Button>
          </div>
        ),
    },
  ]

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="text-sm text-slate-500 hover:text-brand-700"
      >
        ← Volver
      </button>

      <h1 className="text-xl font-semibold text-slate-800">Mi cuenta</h1>

      <Card title="Datos de la cuenta">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-400">Nombre</dt>
            <dd className="text-slate-700">{user?.fullName}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Correo</dt>
            <dd className="text-slate-700">{user?.email}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Teléfono</dt>
            <dd className="text-slate-700">{user?.phone ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Verificado</dt>
            <dd className="text-slate-700">{user?.emailVerifiedAt ? 'Sí' : 'No'}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-slate-400">
          La edición de perfil y el cambio de contraseña no están disponibles todavía.
        </p>
      </Card>

      <Card title="Sesiones activas">
        {error && (
          <div className="mb-3">
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
            empty={<p className="text-sm text-slate-500">No hay sesiones.</p>}
          />
        ) : null}
      </Card>

      <Button
        variant="danger"
        onClick={() => void logout().then(() => navigate('/login', { replace: true }))}
      >
        Cerrar sesión en este dispositivo
      </Button>
    </div>
  )
}
