export const VOTE_TYPES = ['SINGLE', 'QUORUM'] as const
export type VoteType = (typeof VOTE_TYPES)[number]

export const VOTE_STATUSES = ['DRAFT', 'OPEN', 'CLOSED'] as const
export type VoteStatus = (typeof VOTE_STATUSES)[number]

export const VOTE_RESULT_VISIBILITIES = ['AFTER_CLOSE', 'LIVE', 'ADMIN_ONLY'] as const
export type VoteResultVisibility = (typeof VOTE_RESULT_VISIBILITIES)[number]

export interface VoteOption {
  id: string
  label: string
  position: number
  isAbstention: boolean
}

export interface Vote {
  id: string
  communityId: string
  title: string
  question: string
  description: string | null
  type: VoteType
  status: VoteStatus
  effectiveStatus: VoteStatus
  startsAt: string
  endsAt: string
  allowAbstention: boolean
  quorumPercent: number | null
  resultVisibility: VoteResultVisibility
  options: VoteOption[]
  myOptionId: string | null
  createdBy: string | null
  createdByName: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface VoteResultOption {
  id: string
  label: string
  position: number
  isAbstention: boolean
  votes: number
  percent: number
}

export interface VoteResults {
  id: string
  status: VoteStatus
  effectiveStatus: VoteStatus
  endsAt: string
  allowAbstention: boolean
  eligibleCount: number
  turnout: number
  participationPercent: number
  quorumRequired: boolean
  quorumPercent: number | null
  quorumMet: boolean | null
  abstentionCount: number
  options: VoteResultOption[]
}

export const VOTE_TYPE_LABELS: Record<VoteType, string> = {
  SINGLE: 'Simple',
  QUORUM: 'Con quórum',
}

export const VOTE_STATUS_LABELS: Record<VoteStatus, string> = {
  DRAFT: 'Borrador',
  OPEN: 'Abierta',
  CLOSED: 'Cerrada',
}

export const VOTE_RESULT_VISIBILITY_LABELS: Record<VoteResultVisibility, string> = {
  AFTER_CLOSE: 'Al cerrar',
  LIVE: 'En directo',
  ADMIN_ONLY: 'Solo administración',
}
