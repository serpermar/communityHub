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
  SkeletonTable,
  EmptyBoxIcon,
  VOTE_STATUS_TONES,
  type Column,
} from '@/components/ui'
import { isManager } from '@/types/roles'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { useUrlFilters } from '@/hooks/useUrlFilters'
import { formatDateTime } from '@/utils/format'
import { listVotes } from '../api'
import { VOTE_STATUS_LABELS, VOTE_STATUSES, type Vote, type VoteStatus } from '../types'
import styles from './VotingPage.module.css'

export function VotingPage() {
  const navigate = useNavigate()
  const { active, role } = useCommunity()
  const { filters, page, setFilter, setPage } = useUrlFilters({ status: VOTE_STATUSES })
  const status = filters.status

  const result = useResource(
    () =>
      listVotes(active!.id, {
        status: (status || undefined) as VoteStatus | undefined,
        page,
        limit: 20,
      }),
    [active?.id, status, page],
  )

  const columns: Column<Vote>[] = [
    {
      key: 'title',
      header: 'Votación',
      sortable: true,
      sortValue: (vote) => vote.title,
      render: (vote) => (
        <Link to={`/c/${active!.id}/votes/${vote.id}`} className={styles.titleLink}>
          {vote.title}
        </Link>
      ),
    },
    {
      key: 'question',
      header: 'Pregunta',
      sortable: true,
      sortValue: (vote) => vote.question,
      render: (vote) => vote.question,
    },
    {
      key: 'status',
      header: 'Estado',
      sortable: true,
      sortValue: (vote) => vote.effectiveStatus,
      render: (vote) => (
        <Badge tone={VOTE_STATUS_TONES[vote.effectiveStatus]}>
          {VOTE_STATUS_LABELS[vote.effectiveStatus]}
        </Badge>
      ),
    },
    {
      key: 'endsAt',
      header: 'Cierra',
      sortable: true,
      sortValue: (vote) => vote.endsAt,
      render: (vote) => formatDateTime(vote.endsAt),
    },
  ]

  return (
    <div className={styles.page}>
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
          onChange={(event) => setFilter('status', event.target.value)}
          className={styles.filterSelect}
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
        <SkeletonTable columns={4} />
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
                  icon={<EmptyBoxIcon className={styles.emptyIcon} />}
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
