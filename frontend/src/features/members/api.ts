import { api } from '@/services/http'
import type { MemberRole } from '@/types/roles'
import type { Invitation, InvitationCreated, Member, MemberStatus, RedeemResult } from './types'

export function listMembers(communityId: string): Promise<Member[]> {
  return api.get<Member[]>(`/communities/${communityId}/members`)
}

export function getMember(communityId: string, memberId: string): Promise<Member> {
  return api.get<Member>(`/communities/${communityId}/members/${memberId}`)
}

export type UpdateMemberInput = { role: MemberRole } | { status: MemberStatus }

export function updateMember(
  communityId: string,
  memberId: string,
  input: UpdateMemberInput,
): Promise<Member> {
  return api.patch<Member>(`/communities/${communityId}/members/${memberId}`, input)
}

export function listInvitations(communityId: string): Promise<Invitation[]> {
  return api.get<Invitation[]>(`/communities/${communityId}/invitations`)
}

export function createInvitation(communityId: string, email: string): Promise<InvitationCreated> {
  return api.post<InvitationCreated>(`/communities/${communityId}/invitations`, { email })
}

export function revokeInvitation(communityId: string, invitationId: string): Promise<void> {
  return api.delete<void>(`/communities/${communityId}/invitations/${invitationId}`)
}

export function redeemInvitation(code: string): Promise<RedeemResult> {
  return api.post<RedeemResult>('/invitations/redeem', { code })
}
