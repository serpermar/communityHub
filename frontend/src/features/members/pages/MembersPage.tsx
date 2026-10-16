import { useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  Select,
  type Column,
} from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { formatDate } from '@/utils/format'
import { MEMBER_ROLES, MEMBER_ROLE_LABELS, type MemberRole } from '@/types/roles'
import {
  createInvitation,
  listInvitations,
  listMembers,
  revokeInvitation,
  updateMember,
} from '../api'
import { MEMBER_STATUS_LABELS, MEMBER_STATUSES, type Member, type MemberStatus } from '../types'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function MembersPage() {
  const { active, role } = useCommunity()
  const isAdmin = role === 'ADMIN'
  const [actionError, setActionError] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [createdCode, setCreatedCode] = useState<string | null>(null)

  const members = useResource(() => listMembers(active!.id), [active?.id])
  const invitations = useResource(
    () => (isAdmin ? listInvitations(active!.id) : Promise.resolve([])),
    [active?.id, isAdmin],
  )

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<{ email: string }>({ defaultValues: { email: '' } })

  const change = async (member: Member, input: Parameters<typeof updateMember>[2]) => {
    setActionError(null)
    try {
      await updateMember(active!.id, member.id, input)
      members.reload()
    } catch (caught) {
      setActionError(ApiError.from(caught).message)
    }
  }

  const onInvite = handleSubmit(async (values) => {
    setActionError(null)
    try {
      const created = await createInvitation(active!.id, values.email.trim())
      setCreatedCode(created.code)
      reset({ email: '' })
      invitations.reload()
    } catch (caught) {
      setActionError(ApiError.from(caught).message)
    }
  })

  const columns: Column<Member>[] = [
    { key: 'name', header: 'Miembro', render: (row) => row.fullName ?? '—' },
    { key: 'email', header: 'Correo', render: (row) => row.email ?? '—' },
    { key: 'unit', header: 'Vivienda', render: (row) => row.unitNumber ?? '—' },
    {
      key: 'role',
      header: 'Rol',
      render: (row) =>
        isAdmin ? (
          <Select
            aria-label={`Rol de ${row.fullName ?? 'miembro'}`}
            value={row.role}
            onChange={(event) => void change(row, { role: event.target.value as MemberRole })}
            className="w-40"
          >
            {MEMBER_ROLES.map((value) => (
              <option key={value} value={value}>
                {MEMBER_ROLE_LABELS[value]}
              </option>
            ))}
          </Select>
        ) : (
          MEMBER_ROLE_LABELS[row.role]
        ),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (row) =>
        isAdmin ? (
          <Select
            aria-label={`Estado de ${row.fullName ?? 'miembro'}`}
            value={row.status}
            onChange={(event) => void change(row, { status: event.target.value as MemberStatus })}
            className="w-36"
          >
            {MEMBER_STATUSES.map((value) => (
              <option key={value} value={value}>
                {MEMBER_STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
        ) : (
          <Badge tone={row.status === 'ACTIVE' ? 'green' : 'slate'}>
            {MEMBER_STATUS_LABELS[row.status]}
          </Badge>
        ),
    },
    { key: 'joined', header: 'Alta', render: (row) => formatDate(row.joinedAt) },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Miembros</h1>
        {isAdmin && <Button onClick={() => setInviteOpen(true)}>Invitar</Button>}
      </div>

      {actionError && <Alert variant="error">{actionError}</Alert>}

      {members.loading ? (
        <LoadingState />
      ) : members.error ? (
        <ErrorState error={members.error} onRetry={members.reload} />
      ) : members.data ? (
        <Card>
          <DataTable
            columns={columns}
            rows={members.data}
            rowKey={(row) => row.id}
            empty={<EmptyState title="No hay miembros" />}
          />
        </Card>
      ) : null}

      {isAdmin && (
        <Card title="Invitaciones pendientes">
          {invitations.loading ? (
            <LoadingState />
          ) : invitations.data && invitations.data.length > 0 ? (
            <ul className="space-y-2">
              {invitations.data.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-2 text-sm"
                >
                  <div>
                    <p className="text-slate-700">{invitation.email}</p>
                    <p className="text-xs text-slate-400">
                      {invitation.acceptedAt
                        ? `Aceptada el ${formatDate(invitation.acceptedAt)}`
                        : `Caduca el ${formatDate(invitation.expiresAt)}`}
                    </p>
                  </div>
                  {!invitation.acceptedAt && (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() =>
                        void revokeInvitation(active!.id, invitation.id)
                          .then(() => invitations.reload())
                          .catch((caught) => setActionError(ApiError.from(caught).message))
                      }
                    >
                      Revocar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No hay invitaciones pendientes.</p>
          )}
        </Card>
      )}

      <Modal open={inviteOpen} title="Invitar a la comunidad" onClose={() => setInviteOpen(false)}>
        {createdCode ? (
          <div className="space-y-3">
            <Alert variant="success">
              Invitación creada. Copia el código y compártelo: solo se muestra una vez.
            </Alert>
            <code className="block break-all rounded-md bg-slate-100 px-3 py-2 text-sm">
              {createdCode}
            </code>
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  setCreatedCode(null)
                  setInviteOpen(false)
                }}
              >
                Cerrar
              </Button>
            </div>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={onInvite} noValidate>
            <Field
              label="Correo del invitado"
              htmlFor="invite-email"
              error={errors.email?.message}
              required
            >
              <Input
                id="invite-email"
                type="email"
                {...register('email', {
                  required: 'El correo es obligatorio.',
                  pattern: { value: EMAIL_PATTERN, message: 'Correo no válido.' },
                })}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setInviteOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" loading={isSubmitting}>
                Crear invitación
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
