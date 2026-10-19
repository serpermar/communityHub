// ---------------------------------------------------------------------------
// Acceso a datos de IA.
//
// Es el unico sitio del modulo que escribe SQL. Todas las funciones reciben el
// cliente de transaccion, nunca el singleton: por construccion no se puede leer
// nada fuera del contexto de RLS.
//
// Casi todo va por SQL a mano porque las tablas de IA tienen permisos recortados
// a proposito (02l_ai.sql):
//
//   - El borrado de una sesion va por `app_delete_chat_session()`: `app_runtime`
//     NO tiene `delete` sobre `ai_chat_sessions`.
//   - La cache va SOLO por `app_ai_cache_get/put`: `app_runtime` no tiene ningun
//     permiso sobre `ai_cache`.
//   - `incident_drafts` no tiene `select`: el alta NO puede leer su propia fila
//     (nada de `returning`), asi que el id y `expires_at` los calcula el backend
//     y se insertan explicitos. Y la confirmacion va por
//     `app_confirm_incident_draft()`.
//
// Ningun valor del cliente va dentro de un `Prisma.raw`: los nombres de columna
// van literales en la plantilla y lo demas viaja como parametro ligado.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { type Prisma } from '@prisma/client'
import type { Citation, IncidentProposal } from './types.js'

type Tx = Prisma.TransactionClient

// --- Consumo (AI-5) ----------------------------------------------------------

export type UsageRow = {
  requests: number
  input_tokens: number
  output_tokens: number
  cache_hits: number
}

export async function usageToday(tx: Tx, userId: string): Promise<UsageRow> {
  const rows = await tx.$queryRaw<UsageRow[]>`
    select requests, input_tokens, output_tokens, cache_hits
      from app_ai_usage_today(${userId}::uuid)
  `
  return rows[0] ?? { requests: 0, input_tokens: 0, output_tokens: 0, cache_hits: 0 }
}

export async function consumeUsage(
  tx: Tx,
  userId: string,
  input: { requests: number; inputTokens: number; outputTokens: number; cacheHits: number; maxRequests: number; maxTokens: number },
): Promise<UsageRow & { exceeded: string | null }> {
  const rows = await tx.$queryRaw<Array<UsageRow & { exceeded: string | null }>>`
    select requests, input_tokens, output_tokens, cache_hits, exceeded
      from app_ai_usage_consume(
        ${userId}::uuid,
        ${input.requests}::integer,
        ${input.inputTokens}::integer,
        ${input.outputTokens}::integer,
        ${input.cacheHits}::integer,
        ${input.maxRequests}::integer,
        ${input.maxTokens}::integer
      )
  `
  return rows[0] ?? { requests: 0, input_tokens: 0, output_tokens: 0, cache_hits: 0, exceeded: null }
}

// --- Cache de clasificaciones (AI-6) -----------------------------------------

export async function cacheGet(tx: Tx, hash: string): Promise<IncidentProposal | null> {
  const rows = await tx.$queryRaw<Array<{ result: IncidentProposal | null }>>`
    select app_ai_cache_get(${hash}::text) as result
  `
  return rows[0]?.result ?? null
}

export async function cachePut(tx: Tx, hash: string, kind: string, result: IncidentProposal, ttlHours: number): Promise<void> {
  await tx.$executeRaw`
    select app_ai_cache_put(${hash}::text, ${kind}::text, ${JSON.stringify(result)}::jsonb, ${ttlHours}::integer)
  `
}

// --- Sesiones de chat (AI-7, AI-11) ------------------------------------------

export type SessionRow = {
  id: string
  user_id: string
  community_id: string | null
  title: string | null
  model_used: string | null
  created_at: Date
  updated_at: Date
}

export async function insertSession(
  tx: Tx,
  input: { userId: string; communityId: string | null; title: string | null; model: string | null },
): Promise<SessionRow> {
  const rows = await tx.$queryRaw<SessionRow[]>`
    insert into ai_chat_sessions (user_id, community_id, title, model_used)
    values (${input.userId}::uuid, ${input.communityId}::uuid, ${input.title}, ${input.model})
    returning id, user_id, community_id, title, model_used, created_at, updated_at
  `
  return rows[0] as SessionRow
}

export async function findSessionOwn(tx: Tx, sessionId: string): Promise<SessionRow | null> {
  const rows = await tx.$queryRaw<SessionRow[]>`
    select id, user_id, community_id, title, model_used, created_at, updated_at
      from ai_chat_sessions
     where id = ${sessionId}::uuid
  `
  return rows[0] ?? null
}

export async function listSessions(
  tx: Tx,
  input: { limit: number; offset: number },
): Promise<{ rows: SessionRow[]; total: number }> {
  const rows = await tx.$queryRaw<Array<SessionRow & { total_count: bigint }>>`
    select id, user_id, community_id, title, model_used, created_at, updated_at,
           count(*) over () as total_count
      from ai_chat_sessions
     order by updated_at desc
     limit ${input.limit} offset ${input.offset}
  `
  return { rows, total: Number(rows[0]?.total_count ?? 0) }
}

export async function touchSession(tx: Tx, sessionId: string, model: string | null): Promise<void> {
  await tx.$executeRaw`
    update ai_chat_sessions
       set updated_at = now(),
           model_used = coalesce(${model}, model_used)
     where id = ${sessionId}::uuid
  `
}

export async function deleteSession(tx: Tx, sessionId: string): Promise<void> {
  await tx.$executeRaw`
    select app_delete_chat_session(${sessionId}::uuid)
  `
}

// --- Mensajes de chat --------------------------------------------------------

export type MessageRow = {
  id: string
  session_id: string
  role: string
  content: string
  tool_calls: unknown
  citations: Citation[] | null
  tokens_in: number | null
  tokens_out: number | null
  created_at: Date
}

export async function insertMessage(
  tx: Tx,
  input: {
    sessionId: string
    role: 'user' | 'assistant' | 'system' | 'tool'
    content: string
    toolCalls?: unknown
    citations?: Citation[] | null
    tokensIn?: number | null
    tokensOut?: number | null
  },
): Promise<MessageRow> {
  const toolCalls = input.toolCalls === undefined ? null : JSON.stringify(input.toolCalls)
  const citations = input.citations === undefined || input.citations === null ? null : JSON.stringify(input.citations)

  const rows = await tx.$queryRaw<MessageRow[]>`
    insert into ai_chat_messages (session_id, role, content, tool_calls, citations, tokens_in, tokens_out)
    values (
      ${input.sessionId}::uuid,
      ${input.role},
      ${input.content},
      ${toolCalls}::jsonb,
      ${citations}::jsonb,
      ${input.tokensIn ?? null}::integer,
      ${input.tokensOut ?? null}::integer
    )
    returning id, session_id, role, content, tool_calls, citations, tokens_in, tokens_out, created_at
  `
  return rows[0] as MessageRow
}

export async function listMessages(
  tx: Tx,
  sessionId: string,
  input: { limit: number; offset: number },
): Promise<{ rows: MessageRow[]; total: number }> {
  const rows = await tx.$queryRaw<Array<MessageRow & { total_count: bigint }>>`
    select id, session_id, role, content, tool_calls, citations, tokens_in, tokens_out, created_at,
           count(*) over () as total_count
      from ai_chat_messages
     where session_id = ${sessionId}::uuid
     order by created_at asc
     limit ${input.limit} offset ${input.offset}
  `
  return { rows, total: Number(rows[0]?.total_count ?? 0) }
}

// --- Borradores de incidencia (AI-2, AI-14) ----------------------------------

export type DraftInsert = {
  communityId: string
  userId: string
  rawInput: string
  proposal: IncidentProposal
  confidence: number
  needsHumanReview: boolean
  expiresAt: Date
}

/**
 * Alta de un borrador. Devuelve el id y la fecha calculados aqui, no leidos de
 * la fila: `app_runtime` no tiene `select` sobre `incident_drafts` a proposito.
 */
export async function insertDraft(tx: Tx, input: DraftInsert): Promise<{ id: string; expiresAt: Date }> {
  const id = randomUUID()

  await tx.$executeRaw`
    insert into incident_drafts
      (id, community_id, user_id, raw_input, proposal, confidence, needs_human_review, expires_at)
    values (
      ${id}::uuid,
      ${input.communityId}::uuid,
      ${input.userId}::uuid,
      ${input.rawInput},
      ${JSON.stringify(input.proposal)}::jsonb,
      ${input.confidence}::numeric,
      ${input.needsHumanReview}::boolean,
      ${input.expiresAt}::timestamptz
    )
  `

  return { id, expiresAt: input.expiresAt }
}

export async function confirmDraft(tx: Tx, draftId: string, patch: Record<string, unknown>): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ incident_id: string }>>`
    select app_confirm_incident_draft(${draftId}::uuid, ${JSON.stringify(patch)}::jsonb) as incident_id
  `
  return rows[0]?.incident_id as string
}

export async function incidentCommunity(tx: Tx, incidentId: string): Promise<string | null> {
  const rows = await tx.$queryRaw<Array<{ community_id: string | null }>>`
    select app_incident_community(${incidentId}::uuid) as community_id
  `
  return rows[0]?.community_id ?? null
}

// --- Auditoria (AI-13) -------------------------------------------------------
//
// El INSERT vive en `audit/repository.ts` (M-8) para compartirlo con MCP y los
// agentes. Se reexporta aqui para no romper a quien ya importaba `repo.insertAudit`.

export { insertAudit, type AuditInput } from '../audit/repository.js'
