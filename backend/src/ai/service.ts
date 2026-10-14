// ---------------------------------------------------------------------------
// Servicio de IA: orquesta sesiones, chat, clasificacion, borradores, confirm y
// catalogo de tools.
//
// Aqui vive la logica de negocio del bloque. El controller reparte peticiones y
// el repository escribe SQL; ninguno de los dos decide.
//
// Dos ideas que recorren todo el archivo:
//
//   - El `communityId` sale del cuerpo o de la sesion, y SIEMPRE se valida
//     contra la pertenencia del actor antes de usarse (AI-10). El rol no viaja en
//     el cuerpo: se resuelve con `app_role_in()`.
//   - Las tools llaman a los services de 04-10 (D-3). Este archivo no vuelve a
//     implementar una regla de negocio que ya existe.
// ---------------------------------------------------------------------------

import { withContext } from '../context.js'
import { forbidden, notFound } from '../http/errors.js'
import { env } from '../config/env.js'
import * as communities from '../communities/service.js'
import * as incidents from '../incidents/service.js'
import { runAssistant, type ChatEvent } from './assistant.js'
import { classifyIncident } from './classifier.js'
import { aiNotConfigured, aiQuotaExceeded, chatSessionNotFound, ejecuta } from './errors.js'
import { getLLMClient } from './llm/router.js'
import type { LLMClient, LLMMessage } from './llm/client.js'
import * as repo from './repository.js'
import { ALL_TOOLS, runTool, toolsForRoles, type ToolContext } from './tools/index.js'
import type { CommunityRole, IncidentProposal } from './types.js'
import type { ChatBodyInput, ConfirmBodyInput, PaginationQueryInput } from './validators.js'

// --- Vistas (el contrato de salida de la API) --------------------------------

export type SessionView = {
  id: string
  title: string | null
  communityId: string | null
  model: string | null
  createdAt: string
  updatedAt: string
}

export type MessageView = {
  id: string
  role: string
  content: string
  toolCalls: unknown
  citations: unknown
  tokensIn: number | null
  tokensOut: number | null
  createdAt: string
}

export type DraftView = {
  id: string
  proposal: IncidentProposal
  status: string
  confidence: number
  needsHumanReview: boolean
  createdAt: string
  expiresAt: string
}

export type ToolCatalogItem = {
  name: string
  description: string
  roles: CommunityRole[]
  requiresCommunity: boolean
}

export type Paged<T> = {
  items: T[]
  meta: { page: number; limit: number; total: number }
}

// --- Helpers -----------------------------------------------------------------

function toSessionView(row: repo.SessionRow): SessionView {
  return {
    id: row.id,
    title: row.title,
    communityId: row.community_id,
    model: row.model_used,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function toMessageView(row: repo.MessageRow): MessageView {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    toolCalls: row.tool_calls,
    citations: row.citations,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    createdAt: row.created_at.toISOString(),
  }
}

/** El rol del actor en una comunidad, o null si no es miembro. */
export async function roleInCommunity(userId: string, communityId: string): Promise<CommunityRole | null> {
  const rows = await withContext({ userId, communityId }, (tx) =>
    tx.$queryRaw<Array<{ role: string | null }>>`
      select app_role_in(${communityId}::uuid) as role
    `,
  )
  return (rows[0]?.role ?? null) as CommunityRole | null
}

/** El rol del actor en su comunidad, con 403 si no pertenece. */
async function requireRole(userId: string, communityId: string): Promise<CommunityRole> {
  const role = await roleInCommunity(userId, communityId)
  if (!role) throw forbidden('No perteneces a esta comunidad.')
  return role
}

/**
 * Aplica las reglas del sistema a una propuesta que llega ya calculada (AI-12):
 * la revision humana se fuerza si la prioridad es CRITICAL o la confianza es
 * baja, aunque el cliente haya dicho que no hace falta.
 */
function avecCommitment(proposal: IncidentProposal): IncidentProposal {
  const needsHumanReview = proposal.needsHumanReview || proposal.priority === 'CRITICAL' || proposal.confidence < env.AI_CONFIDENCE_THRESHOLD
  return { ...proposal, needsHumanReview }
}

/** Consume presupuesto y lanza 429 si se pasa del techo (AI-5). */
async function consume(
  userId: string,
  input: { requests: number; inputTokens: number; outputTokens: number; cacheHits: number },
): Promise<void> {
  const usage = await withContext({ userId, communityId: null }, (tx) =>
    repo.consumeUsage(tx, userId, {
      ...input,
      maxRequests: env.AI_DAILY_MAX_REQUESTS,
      maxTokens: env.AI_DAILY_MAX_TOKENS,
    }),
  )

  if (usage.exceeded) throw aiQuotaExceeded()
}

/** Comprueba el presupuesto ANTES de abrir un stream, para poder dar 429 JSON. */
async function assertBudget(userId: string): Promise<void> {
  const usage = await withContext({ userId, communityId: null }, (tx) => repo.usageToday(tx, userId))
  const tokens = usage.input_tokens + usage.output_tokens

  if (usage.requests >= env.AI_DAILY_MAX_REQUESTS || tokens >= env.AI_DAILY_MAX_TOKENS) {
    throw aiQuotaExceeded()
  }
}

// --- Chat (AI-7, AI-11) ------------------------------------------------------

type ChatContext = {
  session: repo.SessionRow
  history: LLMMessage[]
}

/** Resuelve (o crea) la sesion y persiste el mensaje del usuario. */
async function beginChat(userId: string, input: ChatBodyInput): Promise<ChatContext> {
  return withContext({ userId, communityId: input.communityId ?? null }, async (tx) => {
    let session: repo.SessionRow | null = null

    if (input.sessionId) {
      session = await repo.findSessionOwn(tx, input.sessionId)
      if (!session) throw chatSessionNotFound()
    }

    if (!session) {
      session = await repo.insertSession(tx, {
        userId,
        communityId: input.communityId ?? null,
        title: input.message.slice(0, 120),
        model: env.LLM_PRIMARY_MODEL,
      })
    }

    const { rows } = await repo.listMessages(tx, session.id, { limit: 20, offset: 0 })

    await repo.insertMessage(tx, { sessionId: session.id, role: 'user', content: input.message })

    const history: LLMMessage[] = rows
      .filter((row) => row.role === 'user' || row.role === 'assistant')
      .map((row) => ({ role: row.role as 'user' | 'assistant', content: row.content }))

    return { session, history }
  })
}

/**
 * Un turno de chat. Emite eventos por `onEvent`; el controller los escribe como
 * SSE. Lanza antes de emitir nada si no hay proveedor o no hay presupuesto, para
 * que el cliente reciba un error JSON y no un stream roto.
 */
export async function chat(userId: string, input: ChatBodyInput, onEvent: (event: ChatEvent) => void): Promise<void> {
  const client: LLMClient | null = getLLMClient()
  if (!client) throw aiNotConfigured()

  // Si el cuerpo trae comunidad, el actor tiene que pertenecer a ella (403 si
  // no). Se comprueba antes de abrir el stream para poder dar JSON.
  if (input.communityId) {
    await requireRole(userId, input.communityId)
  }

  await assertBudget(userId)

  const { session, history } = await beginChat(userId, input)

  const role = session.community_id ? await roleInCommunity(userId, session.community_id) : null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), env.AI_REQUEST_TIMEOUT_MS)

  let result
  try {
    result = await ejecuta(() =>
      runAssistant({
        userId,
        sessionId: session.id,
        communityId: session.community_id,
        role,
        client,
        history,
        message: input.message,
        signal: controller.signal,
        onEvent,
      }),
    )
  } finally {
    clearTimeout(timeout)
  }

  await withContext({ userId, communityId: session.community_id }, async (tx) => {
    await repo.insertMessage(tx, {
      sessionId: session.id,
      role: 'assistant',
      content: result.answer,
      citations: result.citations,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    })
    await repo.touchSession(tx, session.id, result.model)
  })
}

export async function listSessions(userId: string, query: PaginationQueryInput): Promise<Paged<SessionView>> {
  const page = query.page ?? 1
  const limit = query.limit ?? 20

  const { rows, total } = await withContext({ userId, communityId: null }, (tx) =>
    repo.listSessions(tx, { limit, offset: (page - 1) * limit }),
  )

  return { items: rows.map(toSessionView), meta: { page, limit, total } }
}

export async function listMessages(
  userId: string,
  sessionId: string,
  query: PaginationQueryInput,
): Promise<Paged<MessageView>> {
  const page = query.page ?? 1
  const limit = query.limit ?? 50

  return withContext({ userId, communityId: null }, async (tx) => {
    const session = await repo.findSessionOwn(tx, sessionId)
    if (!session) throw chatSessionNotFound()

    const { rows, total } = await repo.listMessages(tx, sessionId, { limit, offset: (page - 1) * limit })
    return { items: rows.map(toMessageView), meta: { page, limit, total } }
  })
}

export async function deleteSession(userId: string, sessionId: string): Promise<void> {
  await ejecuta(() => withContext({ userId, communityId: null }, (tx) => repo.deleteSession(tx, sessionId)))
}

// --- Clasificacion y borradores (AI-2, AI-6, AI-14) --------------------------

export type ClassifyResult = {
  proposal: IncidentProposal
  tokensIn: number
  tokensOut: number
  cacheHit: boolean
}

export async function classify(userId: string, communityId: string, description: string): Promise<ClassifyResult> {
  await requireRole(userId, communityId)

  const client = getLLMClient()
  const result = await ejecuta(() => classifyIncident(userId, description, client))

  await consume(userId, {
    requests: result.cacheHit ? 0 : 1,
    inputTokens: result.tokensIn,
    outputTokens: result.tokensOut,
    cacheHits: result.cacheHit ? 1 : 0,
  })

  return result
}

export async function createDraft(
  userId: string,
  communityId: string,
  description: string,
  proposal?: IncidentProposal,
): Promise<DraftView> {
  await requireRole(userId, communityId)

  let finalProposal: IncidentProposal

  if (proposal) {
    finalProposal = avecCommitment(proposal)
  } else {
    const client = getLLMClient()
    const result = await ejecuta(() => classifyIncident(userId, description, client))
    finalProposal = result.proposal

    await consume(userId, {
      requests: result.cacheHit ? 0 : 1,
      inputTokens: result.tokensIn,
      outputTokens: result.tokensOut,
      cacheHits: result.cacheHit ? 1 : 0,
    })
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  const { id } = await withContext({ userId, communityId }, (tx) =>
    repo.insertDraft(tx, {
      communityId,
      userId,
      rawInput: description,
      proposal: finalProposal,
      confidence: finalProposal.confidence,
      needsHumanReview: finalProposal.needsHumanReview,
      expiresAt,
    }),
  )

  return {
    id,
    proposal: finalProposal,
    status: 'PENDING',
    confidence: finalProposal.confidence,
    needsHumanReview: finalProposal.needsHumanReview,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
  }
}

/**
 * Confirma un borrador: crea la incidencia (AI_SUGGESTION) y la devuelve con el
 * mismo DTO del bloque 04.
 *
 * En dos transacciones y no en una: la primera confirma el borrador y devuelve el
 * id; la segunda resuelve la comunidad y delega en `incidents.getIncident`. Meter
 * `getIncident` (que abre su propio `withContext`) dentro de la transaccion del
 * confirm haria un `withContext` anidado, y el contexto del interno no veria la
 * fila que aun no se ha commiteado.
 */
export async function confirmDraft(userId: string, draftId: string, patch: ConfirmBodyInput): Promise<unknown> {
  const incidentId = await ejecuta(() =>
    withContext({ userId, communityId: null }, (tx) => repo.confirmDraft(tx, draftId, patch as Record<string, unknown>)),
  )

  const communityId = await withContext({ userId, communityId: null }, (tx) => repo.incidentCommunity(tx, incidentId))

  if (!communityId) {
    // La incidencia existe (la acabamos de crear) pero el actor no la ve: seria
    // un bug, no un caso de negocio. Se trata como no encontrada.
    throw notFound('La incidencia confirmada no se puede leer.')
  }

  return incidents.getIncident(userId, communityId, incidentId)
}

// --- Catalogo y preview de tools (AI-1, AI-9, AI-10) -------------------------

/**
 * El catalogo filtrado por el rol del actor en cada comunidad de la que es
 * miembro. Sin comunidad en la URL devuelve la UNION: el catalogo del rol menos
 * restrictivo, anotando en cada tool los roles que pueden usarla.
 */
export async function listTools(userId: string): Promise<ToolCatalogItem[]> {
  const memberships = await communities.listMine(userId)
  const roles = new Set<CommunityRole>()

  for (const membership of memberships) {
    if (membership.memberRole) roles.add(membership.memberRole as CommunityRole)
  }

  return toolsForRoles(ALL_TOOLS, roles).map((tool) => ({
    name: tool.name,
    description: tool.description,
    roles: tool.roles,
    requiresCommunity: tool.requiresCommunity,
  }))
}

export async function previewTool(
  userId: string,
  toolName: string,
  communityId: string,
  args: unknown,
): Promise<{ tool: string; result: unknown }> {
  const role = await requireRole(userId, communityId)

  const ctx: ToolContext = {
    userId,
    communityId,
    role,
    client: getLLMClient(),
  }

  const outcome = await runTool(ALL_TOOLS, toolName, args, ctx)
  return { tool: toolName, result: outcome.result }
}
