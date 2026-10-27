import { useDeferredValue, useMemo, useState } from 'react'
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
  Modal,
  PageHeader,
  Pagination,
  Select,
  SkeletonList,
  SkeletonTable,
  EmptyBoxIcon,
  useToast,
  MEMBER_STATUS_TONES,
  type Column,
} from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { useUrlFilters } from '@/hooks/useUrlFilters'
import { t } from '@/i18n'
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
import styles from './MembersPage.module.css'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PAGE_SIZE = 10

export function MembersPage() {
  const { active, role } = useCommunity()
  const { notify } = useToast()
  const isAdmin = role === 'ADMIN'
  const [actionError, setActionError] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [createdCode, setCreatedCode] = useState<string | null>(null)
  const { filters, page, sort, setFilter, setPage, setSort } = useUrlFilters({ q: undefined })
  const search = filters.q
  const deferredSearch = useDeferredValue(search ?? '')

  const members = useResource(() => listMembers(active!.id), [active?.id])
  const invitations = useResource(
    () => (isAdmin ? listInvitations(active!.id) : Promise.resolve([])),
    [active?.id, isAdmin],
  )

  const filtered = useMemo(() => {
    const term = (deferredSearch ?? '').trim().toLowerCase()
    const all = members.data ?? []
    if (!term) return all
    return all.filter((member) =>
      [member.fullName, member.email, member.unitNumber]
        .filter((value): value is string => typeof value === 'string')
        .some((value) => value.toLowerCase().includes(term)),
    )
  }, [members.data, deferredSearch])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

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
      notify(t('toast.updated'), 'success')
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
      notify(t('toast.created'), 'success')
      reset({ email: '' })
      invitations.reload()
    } catch (caught) {
      setActionError(ApiError.from(caught).message)
    }
  })

  const columns: Column<Member>[] = [
    {
      key: 'name',
      header: 'Miembro',
      sortable: true,
      sortValue: (row) => row.fullName ?? '',
      render: (row) => row.fullName ?? '—',
    },
    {
      key: 'email',
      header: 'Correo',
      sortable: true,
      sortValue: (row) => row.email ?? '',
      render: (row) => row.email ?? '—',
    },
    {
      key: 'unit',
      header: 'Vivienda',
      sortable: true,
      sortValue: (row) => row.unitNumber ?? '',
      render: (row) => row.unitNumber ?? '—',
    },
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
          <Badge tone={MEMBER_STATUS_TONES[row.status]}>{MEMBER_STATUS_LABELS[row.status]}</Badge>
        ),
    },
    {
      key: 'joined',
      header: 'Alta',
      sortable: true,
      sortValue: (row) => row.joinedAt,
      render: (row) => formatDate(row.joinedAt),
    },
  ]

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('nav.members')}
        actions={isAdmin && <Button onClick={() => setInviteOpen(true)}>Invitar</Button>}
      />

      {actionError && <Alert variant="error">{actionError}</Alert>}

      <Card>
        <Input
          aria-label="Buscar miembros"
          placeholder="Buscar por nombre, correo o vivienda…"
          value={search}
          onChange={(event) => setFilter('q', event.target.value)}
          className={styles.searchInput}
        />
        <p role="status" aria-live="polite" className={styles.searchCount}>
          {members.loading
            ? 'Cargando miembros…'
            : `${filtered.length} ${filtered.length === 1 ? 'miembro' : 'miembros'}${
                search ? ' coinciden con la búsqueda' : ''
              }`}
        </p>
      </Card>

      {members.loading ? (
        <SkeletonTable columns={6} />
      ) : members.error ? (
        <ErrorState error={members.error} onRetry={members.reload} />
      ) : members.data ? (
        <>
          <Card>
            <DataTable
              columns={columns}
              rows={paged}
              rowKey={(row) => row.id}
              sort={sort}
              onSortChange={setSort}
              empty={
                <EmptyState
                  icon={<EmptyBoxIcon className={styles.emptyIcon} />}
                  title="No hay miembros"
                />
              }
            />
          </Card>
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            total={filtered.length}
            onPage={setPage}
          />
        </>
      ) : null}

      {isAdmin && (
        <Card title="Invitaciones pendientes">
          {invitations.loading ? (
            <SkeletonList rows={1} />
          ) : invitations.data && invitations.data.length > 0 ? (
            <ul className={styles.invitationList}>
              {invitations.data.map((invitation) => (
                <li key={invitation.id} className={styles.invitationRow}>
                  <div>
                    <p className={styles.invitationEmail}>{invitation.email}</p>
                    <p className={styles.invitationMeta}>
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
            <p className={styles.emptyInvitations}>No hay invitaciones pendientes.</p>
          )}
        </Card>
      )}

      <Modal open={inviteOpen} title="Invitar a la comunidad" onClose={() => setInviteOpen(false)}>
        {createdCode ? (
          <div className={styles.inviteContent}>
            <Alert variant="success">
              Invitación creada. Copia el código y compártelo: solo se muestra una vez.
            </Alert>
            <code className={styles.inviteCode}>{createdCode}</code>
            <div className={styles.inviteFooter}>
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
          <form className={styles.inviteContent} onSubmit={onInvite} noValidate>
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
            <div className={styles.inviteFooter}>
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
