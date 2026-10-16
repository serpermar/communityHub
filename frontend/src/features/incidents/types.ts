export const INCIDENT_CATEGORIES = [
  'ELEVATOR',
  'ELECTRICITY',
  'PLUMBING',
  'CLEANING',
  'SECURITY',
  'HEATING',
  'OTHER',
] as const
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number]

export const INCIDENT_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export type IncidentPriority = (typeof INCIDENT_PRIORITIES)[number]

export const INCIDENT_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED'] as const
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number]

export interface Incident {
  id: string
  communityId: string
  referenceCode: string
  title: string
  description: string
  category: IncidentCategory
  priority: IncidentPriority
  status: IncidentStatus
  location: string | null
  reporterId: string
  reporterName: string | null
  assignedToId: string | null
  assignedToName: string | null
  needsReview: boolean
  createdVia: string
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface IncidentComment {
  id: string
  incidentId: string
  authorId: string
  authorName: string | null
  body: string
  createdAt: string
}

export const CATEGORY_LABELS: Record<IncidentCategory, string> = {
  ELEVATOR: 'Ascensor',
  ELECTRICITY: 'Electricidad',
  PLUMBING: 'Fontanería',
  CLEANING: 'Limpieza',
  SECURITY: 'Seguridad',
  HEATING: 'Calefacción',
  OTHER: 'Otros',
}

export const PRIORITY_LABELS: Record<IncidentPriority, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
}

export const STATUS_LABELS: Record<IncidentStatus, string> = {
  OPEN: 'Abierta',
  IN_PROGRESS: 'En progreso',
  RESOLVED: 'Resuelta',
  CANCELLED: 'Cancelada',
}
