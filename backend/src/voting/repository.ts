// ---------------------------------------------------------------------------
// Acceso a datos de votaciones.
//
// Es el unico sitio del modulo que escribe SQL. Todas las funciones reciben el
// cliente de transaccion, nunca el singleton: por construccion no se puede leer
// nada fuera del contexto de RLS.
//
// Todo va por SQL a mano y no es mania:
//
//   - `app_runtime` no tiene INSERT/UPDATE/DELETE sobre `votes` ni
//     `vote_options` (02k_voting.sql §9 los revoca y §8 elimina las politicas de
//     escritura), asi que el cliente de Prisma no puede escribir en ninguna de
//     las dos.
//   - El 403/404 y el voto secreto solo existen DENTRO de las funciones
//     SECURITY DEFINER de 02k (V-2/V-3/V-5): un `select * from vote_responses`
//     del backend enumeraria votos, y `app_vote_results()` es la unica lectura
//     que devuelve un recuento agregado.
//   - `created_by_name`, las `options` y `my_option_id` solo existen dentro de
//     `app_list_votes()` (JOINs y subselects que las politicas no dejan hacer
//     desde el cliente).
//
// Ninguna consulta lleva un valor del cliente dentro de un `Prisma.raw`: los
// nombres de columna van LITERALMENTE en la plantilla, porque en `$queryRaw`
// cualquier cosa metida en `${}` viaja como parametro ligado, no como SQL.
// ---------------------------------------------------------------------------

import { type Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

/** Una opcion tal como la agrega `app_list_votes()` en `options` (jsonb). */
export type OptionJson = {
  id: string
  label: string
  position: number
  isAbstention: boolean
}

/**
 * Una fila de lectura de votacion, tal como la devuelve `app_list_votes()`.
 *
 * Los nombres van en `snake_case` porque son los de los `returns table`. El
 * `service.ts` es quien los traduce a camelCase.
 *
 * `type`, `status` y `effective_status` llegan como cadena (ENUM, Prisma no lo
 * tiene tipado para una consulta en crudo). `options` llega ya parseado por el
 * driver (jsonb). `total_count` viene de `count(*) over ()`, repetido en cada
 * fila.
 */
export type VoteRow = {
  id: string
  community_id: string
  title: string
  question: string
  description: string | null
  type: string
  status: string
  effective_status: string
  starts_at: Date
  ends_at: Date
  allow_abstention: boolean
  quorum_percent: number | null
  result_visibility: string
  options: OptionJson[]
  my_option_id: string | null
  created_by: string | null
  created_by_name: string | null
  closed_at: Date | null
  created_at: Date
  updated_at: Date
  total_count: bigint
}

/** Una opcion del recuento, tal como la agrega `app_vote_results()` en `options`. */
export type ResultOptionJson = OptionJson & {
  votes: number
  percent: number
}

/** La fila unica de resultados (spec 10 §5.7, D-2). */
export type ResultRow = {
  id: string
  status: string
  effective_status: string
  ends_at: Date
  allow_abstention: boolean
  eligible_count: bigint
  turnout: bigint
  participation_percent: string
  quorum_required: boolean
  quorum_percent: number | null
  quorum_met: boolean | null
  abstention_count: bigint
  options: ResultOptionJson[]
}

/** Una respuesta propia devuelta por `app_cast_vote()`. */
export type CastVoteRow = {
  vote_id: string
  option_id: string
  weight: number
  created_at: Date
  updated_at: Date
}

/**
 * Filtros del listado, ya validados por zod.
 *
 * `limit` y `offset` van SIEMPRE escritos (no los defaults de la funcion): el
 * calculo `offset = (page - 1) * limit` es del servicio, y si la funcion
 * aplicara otros defaults el segundo pedazo de pagina saldria de mas.
 */
export type FiltrosVotes = {
  vote?: string
  status?: string
  limit: number
  offset: number
}

/**
 * Listar las votaciones de una comunidad, o buscar una por id (V-4: misma
 * funcion, mismo predicado de visibilidad).
 *
 * Toda la autorizacion esta dentro de la funcion: pertenencia, veto a PROVIDER,
 * el DRAFT solo para la gestion y los borrados. Aqui no hay ningun filtro de rol,
 * y no por descuido: reimplementarlo en TypeScript seria una segunda copia de una
 * regla que ya esta escrita y probada en 02k.
 *
 * `communityId` es null en el detalle por id (GET /votes/:id no lleva la
 * comunidad en la URL): el predicado usa la fila, y la funcion hace el 404.
 */
export async function listVotes(
  tx: Tx,
  communityId: string | null,
  filtros: FiltrosVotes,
): Promise<VoteRow[]> {
  return tx.$queryRaw<VoteRow[]>`
    select
      id, community_id, title, question, description,
      type, status, effective_status, starts_at, ends_at,
      allow_abstention, quorum_percent, result_visibility,
      options, my_option_id, created_by, created_by_name,
      closed_at, created_at, updated_at, total_count
      from app_list_votes(
        ${communityId}::uuid,
        ${filtros.vote ?? null}::uuid,
        ${filtros.status ?? null}::vote_status,
        ${filtros.limit}::integer,
        ${filtros.offset}::integer
      )
  `
}

/** Una votacion concreta, o null si no existe o no es visible (V-5: cero filas -> 404). */
export async function findVote(tx: Tx, voteId: string): Promise<VoteRow | null> {
  const rows = await listVotes(tx, null, { vote: voteId, limit: 1, offset: 0 })
  return rows[0] ?? null
}

/**
 * Crear una votacion y devolver su id.
 *
 * `$queryRaw` y no `$executeRaw` porque la funcion devuelve `uuid`. `createdBy`
 * no viaja (V-1): lo escribe la funcion con `app_current_user_id()`. Los campos
 * ausentes del POST los decide la funcion con los mismos `coalesce`/`nullif` que
 * el alta, para que "no lo mandaste" y "lo mandaste vacio" acaben en el mismo
 * sitio. `options` viaja como texto JSON y se castea a `jsonb`.
 */
export async function createVote(
  tx: Tx,
  communityId: string,
  input: {
    title: string
    question: string
    description: string | null
    type?: string
    startsAt: string
    endsAt: string
    allowAbstention?: boolean
    quorumPercent?: number | null
    resultVisibility?: string
    options: string[]
  },
): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    select app_create_vote(
      ${communityId}::uuid,
      ${input.title},
      ${input.question},
      ${input.description},
      ${input.type ?? null}::vote_type,
      ${input.startsAt}::timestamptz,
      ${input.endsAt}::timestamptz,
      ${input.allowAbstention ?? null}::boolean,
      ${input.quorumPercent ?? null}::integer,
      ${input.resultVisibility ?? null}::vote_result_visibility,
      ${JSON.stringify(input.options)}::jsonb
    ) as id
  `

  const row = rows[0]

  if (!row?.id) {
    throw new Error('app_create_vote() no devolvió el id')
  }

  return row.id
}

/**
 * Editar un DRAFT (PATCH parcial, V-7).
 *
 * `$executeRaw` porque la funcion devuelve `setof votes` y la fila se relee
 * despues con `findVote()`, dentro de la misma transaccion: la respuesta sale de
 * una lectura y no de los parametros de entrada.
 *
 * `communityId` no es parametro: la comunidad la decide la propia fila
 * (`app_vote_community`), y el debate del rol lo dirime la funcion.
 */
export async function updateVote(
  tx: Tx,
  voteId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await tx.$executeRaw`
    select app_update_vote(
      ${voteId}::uuid,
      ${JSON.stringify(patch)}::jsonb
    )
  `
}

/** Publicar una votacion (DRAFT -> OPEN, V-6). El estado lo decide la funcion. */
export async function publishVote(tx: Tx, voteId: string): Promise<void> {
  await tx.$executeRaw`
    select app_publish_vote(${voteId}::uuid)
  `
}

/** Cerrar una votacion (OPEN -> CLOSED, V-6). El estado lo decide la funcion. */
export async function closeVote(tx: Tx, voteId: string): Promise<void> {
  await tx.$executeRaw`
    select app_close_vote(${voteId}::uuid)
  `
}

/**
 * Votar (V-11: un voto por usuario, cambiar de voto es UPSERT).
 *
 * `$queryRaw` porque la funcion devuelve la fila escrita. El `user_id` sale de
 * `app_current_user_id()`: nunca viaja como parametro.
 */
export async function castVote(
  tx: Tx,
  voteId: string,
  optionId: string,
): Promise<CastVoteRow | null> {
  const rows = await tx.$queryRaw<CastVoteRow[]>`
    select vote_id, option_id, weight, created_at, updated_at
      from app_cast_vote(${voteId}::uuid, ${optionId}::uuid)
  `

  return rows[0] ?? null
}

/** El recuento agregado de una votacion (V-2/V-12). Una fila, garantizada por los coalesce. */
export async function voteResults(tx: Tx, voteId: string): Promise<ResultRow | null> {
  const rows = await tx.$queryRaw<ResultRow[]>`
    select
      id, status, effective_status, ends_at, allow_abstention,
      eligible_count, turnout, participation_percent,
      quorum_required, quorum_percent, quorum_met,
      abstention_count, options
      from app_vote_results(${voteId}::uuid)
  `

  return rows[0] ?? null
}
