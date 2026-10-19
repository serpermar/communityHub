import { api, cleanParams } from '@/services/http'
import type { ListResult } from '@/types/api'
import type {
  Incident,
  IncidentCategory,
  IncidentComment,
  IncidentPriority,
  IncidentStatus,
} from './types'

export interface IncidentListQuery {
  status?: IncidentStatus
  priority?: IncidentPriority
  category?: IncidentCategory
  q?: string
  page?: number
  limit?: number
}

export function listIncidents(
  communityId: string,
  query: IncidentListQuery,
): Promise<ListResult<Incident>> {
  return api.list<Incident>(`/communities/${communityId}/incidents`, {
    params: cleanParams({ ...query }),
  })
}

export function getIncident(incidentId: string): Promise<Incident> {
  return api.get<Incident>(`/incidents/${incidentId}`)
}

export interface CreateIncidentInput {
  title: string
  description: string
  category?: IncidentCategory
  priority?: IncidentPriority
  location?: string | null
}

export function createIncident(communityId: string, input: CreateIncidentInput): Promise<Incident> {
  return api.post<Incident>(`/communities/${communityId}/incidents`, input)
}

export interface UpdateIncidentInput {
  title: string
  description: string
  category: IncidentCategory
  location?: string | null
  priority?: IncidentPriority
  assignedToId?: string | null
}

export function updateIncident(incidentId: string, input: UpdateIncidentInput): Promise<Incident> {
  return api.put<Incident>(`/incidents/${incidentId}`, input)
}

export function transitionIncident(incidentId: string, status: IncidentStatus): Promise<Incident> {
  return api.patch<Incident>(`/incidents/${incidentId}/status`, { status })
}

export function deleteIncident(incidentId: string): Promise<void> {
  return api.delete(`/incidents/${incidentId}`)
}

export function listComments(incidentId: string): Promise<IncidentComment[]> {
  return api.get<IncidentComment[]>(`/incidents/${incidentId}/comments`)
}

export function addComment(incidentId: string, body: string): Promise<IncidentComment> {
  return api.post<IncidentComment>(`/incidents/${incidentId}/comments`, { body })
}
