// ---------------------------------------------------------------------------
// De los errores de 02l_ai.sql y del proveedor LLM al error HTTP (IA).
//
// Mismo criterio que el bloque 10: se exige EL PAR (errcode, sentinel) y no solo
// el sentinel, para que un titulo de incidencia que por casualidad fuese
// `draft_not_found` no se convierta en un 404.
//
// Aqui ademas viven las fabricas de los codigos nuevos (AI_NOT_CONFIGURED,
// AI_QUOTA_EXCEEDED, AI_PROVIDER_ERROR, AI_TOOL_UNKNOWN, AI_TOOL_FORBIDDEN), que
// no existen en `http/errors.ts` porque no son "errores genericos": son
// especificos de este contrato (§7.5).
// ---------------------------------------------------------------------------

import { Prisma } from '@prisma/client'
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from '../http/errors.js'
import { LLMProviderError } from './llm/client.js'

// --- Fabricas de los codigos del contrato de IA ------------------------------

/** Chat sin proveedor configurado (AI-3). */
export const aiNotConfigured = () =>
  new AppError(503, 'AI_NOT_CONFIGURED', 'El asistente no está disponible en este momento.')

/** Presupuesto diario superado (AI-5). */
export const aiQuotaExceeded = () =>
  new AppError(429, 'AI_QUOTA_EXCEEDED', 'Has agotado tu cuota diaria del asistente. Vuelve mañana.')

/**
 * El proveedor falla y no hay respaldo (AI-4). Es un 502 y no un 500: el proceso
 * esta bien, falla un tercero.
 */
export const aiProviderError = (cause?: unknown) =>
  new AppError(502, 'AI_PROVIDER_ERROR', 'El proveedor de IA no respondió. Inténtalo de nuevo.', cause)

/** `toolName` inexistente en `preview`. */
export const aiToolUnknown = (name: string) =>
  new AppError(404, 'AI_TOOL_UNKNOWN', `La herramienta "${name}" no existe.`)

/** La tool existe, pero el rol del actor no puede usarla (AI-9). */
export const aiToolForbidden = (name: string) =>
  new AppError(403, 'AI_TOOL_FORBIDDEN', `Tu rol no puede usar la herramienta "${name}".`)

/** Sesion de chat inexistente o de otro (AI-7). */
export const chatSessionNotFound = () => new AppError(404, 'CHAT_SESSION_NOT_FOUND', 'Esa conversación no existe.')

/** Borrador inexistente o de otro (AI-14). */
export const draftNotFound = () => new AppError(404, 'INCIDENT_DRAFT_NOT_FOUND', 'Ese borrador no existe.')

// --- Traduccion de (errcode, sentinel) a AppError ----------------------------

type Origen = { errcode: string; message: string }

/**
 * Saca el par (errcode, mensaje) de un fallo de `$queryRaw` / `$executeRaw`. Un
 * fallo de consulta en crudo SIEMPRE llega como `P2010`, con el codigo de
 * PostgreSQL en `meta.code` y no en `message`.
 */
function dePostgres(error: unknown): Origen | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null
  if (error.code !== 'P2010') return null

  const errcode = error.meta?.code
  const message = error.meta?.message

  if (typeof errcode !== 'string' || typeof message !== 'string') return null

  return { errcode, message }
}

/** Los casos de negocio de 02l_ai.sql (§5.6 de la spec). */
const NEGOCIO: ReadonlyArray<{ sentinel: string; errcode: string; error: () => AppError }> = [
  // El borrador no existe o es de otro. Mismo 404 para las dos (C-8).
  { sentinel: 'draft_not_found', errcode: 'P0002', error: () => draftNotFound() },
  // La sesion no existe o es de otro.
  { sentinel: 'session_not_found', errcode: 'P0002', error: () => chatSessionNotFound() },
  // No es miembro de la comunidad del borrador.
  { sentinel: 'forbidden_role', errcode: '42501', error: () => forbidden('Tu rol en esta comunidad no permite esta acción.') },
  // Ya confirmado: 409 con codigo propio, no el generico CONFLICT.
  {
    sentinel: 'draft_already_confirmed',
    errcode: 'U0001',
    error: () => new AppError(409, 'INCIDENT_DRAFT_ALREADY_CONFIRMED', 'Ese borrador ya se confirmó.'),
  },
  // Descartado o caducado: 409 INCIDENT_DRAFT_NOT_PENDING (§7.5).
  {
    sentinel: 'draft_not_pending',
    errcode: 'U0001',
    error: () => new AppError(409, 'INCIDENT_DRAFT_NOT_PENDING', 'Ese borrador ya no está pendiente.'),
  },
  {
    sentinel: 'draft_expired',
    errcode: 'U0001',
    error: () => new AppError(409, 'INCIDENT_DRAFT_NOT_PENDING', 'Ese borrador ha caducado.'),
  },
  // Red de los CHECK/CASE de contenido: el zod lo adelanta, esto es el plan B.
  { sentinel: 'draft_content_invalid', errcode: '22023', error: () => badRequest('La propuesta del borrador no es válida.') },
  { sentinel: 'sin contexto de usuario', errcode: '42501', error: () => unauthorized() },
]

/**
 * Traduce un error de la base de datos al error de HTTP que le corresponde.
 * Devuelve `null` cuando el error no viene de PostgreSQL o no es un caso
 * conocido.
 */
export function translate(error: unknown): AppError | null {
  const origen = dePostgres(error)

  if (!origen) return null

  for (const caso of NEGOCIO) {
    if (origen.errcode === caso.errcode && origen.message.includes(caso.sentinel)) {
      return caso.error()
    }
  }

  // Sin sentinel: 23514 (CHECK) y 22P02/22023 (enum/uuid/jsonb invalido) son
  // problemas de datos de entrada, no bugs. El zod los adelanta casi siempre.
  if (origen.errcode === '23514') return badRequest('Uno de los campos no cumple el formato permitido.')
  if (origen.errcode === '22P02') return badRequest('Uno de los valores enviados no es válido.')
  if (origen.errcode === '22023') return badRequest('Uno de los valores enviados no es válido.')

  // 23505 sin sentinel (p.ej. el upsert de usage): conflicto.
  if (origen.errcode === '23505') return conflict('CONFLICT', 'La operación entra en conflicto con el estado actual.')

  if (origen.errcode === '42501') return forbidden()

  return null
}

/**
 * Traduce a error HTTP: los de Postgres por (errcode, sentinel) y los del
 * proveedor LLM a `AI_PROVIDER_ERROR` (502). Cualquier otra cosa se relanza.
 */
export async function ejecuta<T>(accion: () => Promise<T>): Promise<T> {
  try {
    return await accion()
  } catch (error) {
    const traducido = translate(error)
    if (traducido) throw traducido
    if (error instanceof LLMProviderError) throw aiProviderError(error)
    throw error
  }
}
