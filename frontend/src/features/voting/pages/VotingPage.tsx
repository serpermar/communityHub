import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  Select,
  SkeletonList,
  type Column,
} from '@/components/ui'
import { isManager } from '@/types/roles'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { formatDateTime } from '@/utils/format'
import { listVotes } from '../api'
import { VOTE_STATUS_LABELS, VOTE_STATUSES, type Vote, type VoteStatus } from '../types'

export function VotingPage() {
  const navigate = useNavigate()
  const { active, role } = useCommunity()
  const [status, setStatus] = useState<VoteStatus | ''>('')
  const [page, setPage] = useState(1)

  const result = useResource(
    () => listVotes(active!.id, { status: status || undefined, page, limit: 20 }),
    [active?.id, status, page],
  )

  const columns: Column<Vote>[] = [
    {
      key: 'title',
      header: 'Votación',
      render: (vote) => (
        <Link
          to={`/c/${active!.id}/votes/${vote.id}`}
          className="font-medium text-brand-700 dark:text-brand-400 hover:underline"
        >
          {vote.title}
        </Link>
      ),
    },
    { key: 'question', header: 'Pregunta', render: (vote) => vote.question },
    {
      key: 'status',
      header: 'Estado',
      render: (vote) => (
        <Badge
          tone={
            vote.effectiveStatus === 'OPEN'
              ? 'green'
              : vote.effectiveStatus === 'DRAFT'
                ? 'slate'
                : 'amber'
          }
        >
          {VOTE_STATUS_LABELS[vote.effectiveStatus]}
        </Badge>
      ),
    },
    { key: 'endsAt', header: 'Cierra', render: (vote) => formatDateTime(vote.endsAt) },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Votaciones"
        actions={
          isManager(role) && (
            <Button onClick={() => navigate(`/c/${active!.id}/votes/new`)}>Nueva votación</Button>
          )
        }
      />

      <Card>
        <Select
          aria-label="Estado"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as VoteStatus | '')
            setPage(1)
          }}
          className="sm:w-64"
        >
          <option value="">Todas</option>
          {VOTE_STATUSES.map((value) => (
            <option key={value} value={value}>
              {VOTE_STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
      </Card>

      {result.loading ? (
        <SkeletonList />
      ) : result.error ? (
        <ErrorState error={result.error} onRetry={result.reload} />
      ) : result.data ? (
        <>
          <Card>
            <DataTable
              columns={columns}
              rows={result.data.data}
              rowKey={(row) => row.id}
              empty={
                <EmptyState
                  title="No hay votaciones"
                  description="Crea una votación para consultar a la comunidad."
                  action={
                    isManager(role) ? (
                      <Button onClick={() => navigate(`/c/${active!.id}/votes/new`)}>
                        Nueva votación
                      </Button>
                    ) : undefined
                  }
                />
              }
            />
          </Card>
          <Pagination
            page={result.data.meta.page}
            totalPages={result.data.meta.totalPages}
            total={result.data.meta.total}
            onPage={setPage}
          />
        </>
      ) : null}
    </div>
  )
}
