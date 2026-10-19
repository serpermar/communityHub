// ---------------------------------------------------------------------------
// Tipos compartidos del modulo de IA.
//
// Viven aparte para que `heuristics.ts`, `classifier.ts`, `assistant.ts` y los
// validadores hablen del mismo `IncidentProposal` sin importarse entre ellos.
// ---------------------------------------------------------------------------

export type IncidentCategory =
  'ELEVATOR' | 'ELECTRICITY' | 'PLUMBING' | 'CLEANING' | 'SECURITY' | 'HEATING' | 'OTHER'

export type IncidentPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

/**
 * La propuesta de incidencia (AI-2). NO es una incidencia: es lo que la IA cree
 * que deberia crearse, a la espera de que una persona lo confirme.
 */
export type IncidentProposal = {
  category: IncidentCategory
  priority: IncidentPriority
  title: string
  description: string
  confidence: number
  needsHumanReview: boolean
}

/** Una cita: de que tool salio el dato (AI-8). */
export type Citation = {
  tool: string
  ids: string[]
}

/** Estado de un borrador de incidencia. */
export type DraftStatus = 'PENDING' | 'CONFIRMED' | 'DISMISSED' | 'EXPIRED'

/** El rol de un miembro dentro de una comunidad. */
export type CommunityRole = 'NEIGHBOR' | 'PROVIDER' | 'ADMIN' | 'PRESIDENT'

/** Vista de un borrador devuelta por la API (nunca se lee de la tabla). */
export type IncidentDraftView = {
  id: string
  status: DraftStatus
  proposal: IncidentProposal
  confidence: number
  needsHumanReview: boolean
  createdAt: string
  expiresAt: string
  incidentId: string | null
}
