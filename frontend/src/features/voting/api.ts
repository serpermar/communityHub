import { api, cleanParams, http } from '@/services/http'
import type { ListResult } from '@/types/api'
import type { Vote, VoteResultVisibility, VoteResults, VoteStatus, VoteType } from './types'

export interface VoteListQuery {
  status?: VoteStatus
  page?: number
  limit?: number
}

export function listVotes(communityId: string, query: VoteListQuery): Promise<ListResult<Vote>> {
  return api.list<Vote>(`/communities/${communityId}/votes`, {
    params: cleanParams({ ...query }),
  })
}

export function getVote(voteId: string): Promise<Vote> {
  return api.get<Vote>(`/votes/${voteId}`)
}

export interface VoteInput {
  title: string
  question: string
  description?: string | null
  type: VoteType
  startsAt: string
  endsAt: string
  allowAbstention: boolean
  quorumPercent?: number
  resultVisibility: VoteResultVisibility
  options: string[]
}

export function createVote(communityId: string, input: VoteInput): Promise<Vote> {
  return api.post<Vote>(`/communities/${communityId}/votes`, input)
}

export function publishVote(voteId: string): Promise<Vote> {
  return api.post<Vote>(`/votes/${voteId}/publish`, {})
}

export function closeVote(voteId: string): Promise<Vote> {
  return api.post<Vote>(`/votes/${voteId}/close`, {})
}

export function castVote(voteId: string, optionId: string): Promise<Vote> {
  return api.post<Vote>(`/votes/${voteId}/responses`, { optionId })
}

export function getVoteResults(voteId: string): Promise<VoteResults> {
  return api.get<VoteResults>(`/votes/${voteId}/results`)
}

export async function downloadResultsCsv(voteId: string): Promise<Blob> {
  const response = await http.get(`/votes/${voteId}/results/export`, {
    responseType: 'blob',
  })
  return response.data as Blob
}
