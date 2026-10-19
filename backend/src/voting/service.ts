// ---------------------------------------------------------------------------
// Servicio de votaciones.
//
// La autorizacion esta en las funciones de SQL (02k), igual que en el resto de
// bloques: pertenencia, vetos de rol, ventana de votacion, voto secreto y
// visibilidad de resultados viven DENTRO de la transaccion, en el unico sitio
// donde el motor las ve. Aqui no hay ningun `if (rol === ...)`: seria una
// segunda copia de una regla que ya esta escrita y probada en SQL.
//
// Lo propio de este bloque:
//
//   - TODA lectura de votaciones pasa por `app_list_votes()` (V-4): el listado y
//     el detalle por id comparten consulta, para que no haya dos copias de la
//     visibilidad que puedan discrepar.
//   - El recuento va por `app_vote_results()` (V-2): nunca se lee
//     `vote_responses` en crudo, porque enumeraria votos individuales.
//   - El PATCH solo manda las claves presentes en el cuerpo. Como los opcionales
//     del validador no llevan `.transform()`, una clave ausente no existe en el
//     objeto, y el SQL la distingue de una clave mandada con un valor.
//   - `percent`/`participation_percent` son `numeric`: el driver los devuelve
//     como cadena (o como numero dentro del jsonb) y se normalizan a numero.
// ---------------------------------------------------------------------------

import { withContext } from '../context.js'
import { notFound } from '../http/errors.js'
import * as repo from './repository.js'
import { ejecuta } from './errors.js'
import type {
  CastVoteInput,
  CreateVoteInput,
  UpdateVoteInput,
  VotesQueryInput,
} from './validators.js'

/** La votacion tal como sale en la API (spec 10 §7.3). */
export type VoteView = {
  id: string
  communityId: string
  title: string
  question: string
  description: string | null
  type: string
  status: string
  effectiveStatus: string
  startsAt: string
  endsAt: string
  allowAbstention: boolean
  quorumPercent: number | null
  resultVisibility: string
  options: repo.OptionJson[]
  myOptionId: string | null
  createdBy: string | null
  createdByName: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
}

/** El recuento agregado (spec 10 §7.3). Nunca lleva votos individuales (V-2). */
export type VoteResultsView = {
  id: string
  status: string
  effectiveStatus: string
  endsAt: string
  allowAbstention: boolean
  eligibleCount: number
  turnout: number
  participationPercent: number
  quorumRequired: boolean
  quorumPercent: number | null
  quorumMet: boolean | null
  abstentionCount: number
  options: repo.ResultOptionJson[]
}

/** La respuesta propia del voto emitido (V-11). */
export type CastVoteView = {
  voteId: string
  optionId: string
  weight: number
  createdAt: string
  updatedAt: string
}

export type Paged<T> = {
  items: T[]
  meta: { page: number; limit: number; total: number; totalPages: number }
}

/** Un instante (`timestamptz`) a ISO 8601 UTC, como en el resto de modulos. */
function aInstante(value: Date): string {
  return value.toISOString()
}

function votacionAVista(row: repo.VoteRow): VoteView {
  return {
    id: row.id,
    communityId: row.community_id,
    title: row.title,
    question: row.question,
    description: row.description,
    type: row.type,
    status: row.status,
    effectiveStatus: row.effective_status,
    startsAt: aInstante(row.starts_at),
    endsAt: aInstante(row.ends_at),
    allowAbstention: row.allow_abstention,
    quorumPercent: row.quorum_percent,
    resultVisibility: row.result_visibility,
    options: row.options,
    myOptionId: row.my_option_id,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    closedAt: row.closed_at ? aInstante(row.closed_at) : null,
    createdAt: aInstante(row.created_at),
    updatedAt: aInstante(row.updated_at),
  }
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/** Listar las votaciones de una comunidad (V-5: el no-miembro/PROVIDER recibe 403 DENTRO de la funcion). */
export async function listVotes(
  userId: string,
  communityId: string,
  query: VotesQueryInput,
): Promise<Paged<VoteView>> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const page = query.page ?? 1
      const limit = query.limit ?? 20
      const offset = (page - 1) * limit

      const filtros = { status: query.status, limit, offset }

      const rows = await repo.listVotes(tx, communityId, filtros)

      let total = 0
      const primera = rows[0]

      if (primera) {
        total = Number(primera.total_count)
      } else if (offset > 0) {
        const muestra = await repo.listVotes(tx, communityId, { ...filtros, limit: 1, offset: 0 })
        const primeraMuestra = muestra[0]
        total = primeraMuestra ? Number(primeraMuestra.total_count) : 0
      }

      return {
        items: rows.map(votacionAVista),
        meta: { page, limit, total, totalPages: total === 0 ? 0 : Math.ceil(total / limit) },
      }
    }),
  )
}

/** Una votacion por id (GET /votes/:id). Sin `requireCommunity`: cero filas -> 404 (V-5). */
export async function getVote(userId: string, voteId: string): Promise<VoteView> {
  return ejecuta(() =>
    withContext({ userId, communityId: null }, async (tx) => {
      const row = await repo.findVote(tx, voteId)

      if (!row) {
        throw notFound('Esa votación no existe o no es visible.')
      }

      return votacionAVista(row)
    }),
  )
}

/** El recuento agregado (V-2/V-12). La funcion garantiza UNA fila (D-2). */
export async function voteResults(userId: string, voteId: string): Promise<VoteResultsView> {
  return ejecuta(() =>
    withContext({ userId, communityId: null }, async (tx) => {
      const row = await repo.voteResults(tx, voteId)

      if (!row) {
        throw new Error('app_vote_results() no devolvió la fila garantizada')
      }

      return {
        id: row.id,
        status: row.status,
        effectiveStatus: row.effective_status,
        endsAt: aInstante(row.ends_at),
        allowAbstention: row.allow_abstention,
        eligibleCount: Number(row.eligible_count),
        turnout: Number(row.turnout),
        participationPercent: Number(row.participation_percent),
        quorumRequired: row.quorum_required,
        quorumPercent: row.quorum_percent,
        quorumMet: row.quorum_met,
        abstentionCount: Number(row.abstention_count),
        options: row.options,
      }
    }),
  )
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

/**
 * Alta de una votacion (solo PRESIDENT/ADMIN; la funcion lo repite dentro).
 *
 * La respuesta sale de una RELECTURA con `findVote()` (dentro de la misma
 * transaccion): solo asi lo que devuelve la API es exactamente lo que quedo
 * escrito, con los `btrim`/`nullif` de la funcion ya aplicados y las opciones
 * generadas (incluida la abstencion, V-10).
 */
export async function createVote(
  userId: string,
  communityId: string,
  input: CreateVoteInput,
): Promise<VoteView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const id = await repo.createVote(tx, communityId, {
        title: input.title,
        question: input.question,
        description: input.description ?? null,
        type: input.type,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        allowAbstention: input.allowAbstention,
        quorumPercent: input.quorumPercent ?? null,
        resultVisibility: input.resultVisibility,
        options: input.options,
      })

      const row = await repo.findVote(tx, id)

      if (!row) {
        throw new Error('La votación se creó pero no se puede leer.')
      }

      return votacionAVista(row)
    }),
  )
}

/**
 * Editar un DRAFT (PATCH parcial, V-7). Sin comunidad en la URL:
 * `app_update_vote()` decide el 404, el 403 y el 409 por estado.
 *
 * El objeto `patch` solo lleva las claves PRESENTES en el cuerpo: como los
 * opcionales del validador no transforman, una clave ausente no existe y el SQL
 * la deja como estaba.
 */
export async function updateVote(
  userId: string,
  voteId: string,
  input: UpdateVoteInput,
): Promise<VoteView> {
  const patch: Record<string, unknown> = {}

  if (input.title !== undefined) patch.title = input.title
  if (input.question !== undefined) patch.question = input.question
  if (input.description !== undefined) patch.description = input.description
  if (input.type !== undefined) patch.type = input.type
  if (input.startsAt !== undefined) patch.startsAt = input.startsAt
  if (input.endsAt !== undefined) patch.endsAt = input.endsAt
  if (input.allowAbstention !== undefined) patch.allowAbstention = input.allowAbstention
  if (input.quorumPercent !== undefined) patch.quorumPercent = input.quorumPercent
  if (input.resultVisibility !== undefined) patch.resultVisibility = input.resultVisibility
  if (input.options !== undefined) patch.options = input.options

  return ejecuta(() =>
    withContext({ userId, communityId: null }, async (tx) => {
      await repo.updateVote(tx, voteId, patch)

      const row = await repo.findVote(tx, voteId)

      if (!row) {
        throw new Error('La votación se actualizó pero no se puede leer.')
      }

      return votacionAVista(row)
    }),
  )
}

/** Publicar (DRAFT -> OPEN, V-6). El 409 por estado lo decide la funcion. Relectura para la respuesta. */
export async function publishVote(userId: string, voteId: string): Promise<VoteView> {
  return ejecuta(() =>
    withContext({ userId, communityId: null }, async (tx) => {
      await repo.publishVote(tx, voteId)

      const row = await repo.findVote(tx, voteId)

      if (!row) {
        throw new Error('La votación se publicó pero no se puede leer.')
      }

      return votacionAVista(row)
    }),
  )
}

/** Cerrar (OPEN -> CLOSED, V-6), cierre anticipado incluido. El 409 por estado lo decide la funcion. */
export async function closeVote(userId: string, voteId: string): Promise<VoteView> {
  return ejecuta(() =>
    withContext({ userId, communityId: null }, async (tx) => {
      await repo.closeVote(tx, voteId)

      const row = await repo.findVote(tx, voteId)

      if (!row) {
        throw new Error('La votación se cerró pero no se puede leer.')
      }

      return votacionAVista(row)
    }),
  )
}

/**
 * Votar (V-11). El segundo voto del mismo usuario CAMBIA el primero (UPSERT),
 * no da 409. La ventana, el veto a PROVIDER y el "optionId es de esta votacion"
 * los decide la funcion.
 */
export async function castVote(
  userId: string,
  voteId: string,
  input: CastVoteInput,
): Promise<CastVoteView> {
  return ejecuta(() =>
    withContext({ userId, communityId: null }, async (tx) => {
      const row = await repo.castVote(tx, voteId, input.optionId)

      if (!row) {
        throw new Error('El voto se registró pero no se puede leer.')
      }

      return {
        voteId: row.vote_id,
        optionId: row.option_id,
        weight: row.weight,
        createdAt: aInstante(row.created_at),
        updatedAt: aInstante(row.updated_at),
      }
    }),
  )
}

// ---------------------------------------------------------------------------
// Export (V-13)
// ---------------------------------------------------------------------------

/** Escapa una celda CSV: comillas dobles, comas y saltos de linea (RFC 4180). */
function celdaCsv(valor: string): string {
  if (/[",\r\n]/.test(valor)) {
    return `"${valor.replace(/"/g, '""')}"`
  }
  return valor
}

/**
 * `GET /votes/:id/results/export` (V-13).
 *
 * El CSV es del RECUENTO agregado (`opción,votos,porcentaje`), nunca una fila por
 * voto: exportar los votos individuales romperia V-2 igual que enumerarlos. Se
 * genera en el backend y no en SQL porque es formato, no autorizacion; la
 * visibilidad la decide `app_vote_results()`, a la que se delega.
 */
export async function exportResults(
  userId: string,
  voteId: string,
): Promise<{ filename: string; csv: string }> {
  const resultados = await voteResults(userId, voteId)

  const lineas = ['opción,votos,porcentaje']

  for (const opcion of resultados.options) {
    lineas.push([celdaCsv(opcion.label), String(opcion.votes), String(opcion.percent)].join(','))
  }

  const slug = resultados.id.slice(0, 8)

  return { filename: `votacion-${slug}-resultados.csv`, csv: `${lineas.join('\r\n')}\r\n` }
}
