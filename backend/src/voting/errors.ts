// ---------------------------------------------------------------------------
// Del sentinel de PL/pgSQL al error HTTP (votaciones).
//
// Las funciones de 02k_voting.sql levantan los casos de negocio con un sentinel
// al principio del mensaje y un `errcode` de Postgres. Este archivo es el unico
// sitio que sabe traducirlos.
//
// Se exige EL PAR (errcode, sentinel) y no solo el sentinel, como en los bloques
// 04-09: un sentinel es una cadena de texto, y cualquier titulo o pregunta del
// cliente puede acabar dentro del mensaje de un error de Postgres. Con el par,
// una pregunta que se llamase `vote_not_draft` no puede convertirse en un 409.
//
// Particularidades del bloque (spec 10 §7.5):
//
//   - Cinco conflictos comparten SQLSTATE U0001 —"conflicto del bloque de
//     votaciones"— y solo se distinguen por el sentinel. Cada uno tiene su codigo
//     estable de contrato (VOTE_NOT_DRAFT / VOTE_NOT_OPEN / VOTE_CLOSED /
//     VOTE_ALREADY_CLOSED / VOTE_NOT_PUBLISHED), nunca el generico CONFLICT: el
//     cliente decide que hacer segun el codigo, y "ya esta cerrada" no es lo
//     mismo que "todavia no se ha publicado". Sin sentinel, un U0001 desnudo NO
//     es un 409: es un bug del esquema y se deja pasar como 500.
//   - `vote_option_invalid` y `vote_option_duplicate` son los dos 400 con codigo
//     propio del bloque (VOTE_OPTION_INVALID / VOTE_OPTION_DUPLICATE) en vez de
//     VALIDATION_ERROR: son problemas del CUERPO que el zod no puede adelantar
//     (la lista de opciones es valida en forma; es su contenido el que choca).
//   - `vote_requires_leadership` y `vote_results_forbidden` son 403 con el mismo
//     codigo FORBIDDEN que el resto del proyecto; lo que cambia es el mensaje.
// ---------------------------------------------------------------------------

import { Prisma } from '@prisma/client'
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from '../http/errors.js'

/** El `errcode` y el mensaje que PostgreSQL trae al cliente de Prisma. */
type Origen = { errcode: string; message: string }

/**
 * Saca el par (errcode, mensaje) de un fallo de `$queryRaw` / `$executeRaw`.
 * Un fallo de consulta en crudo SIEMPRE llega como `P2010`, con el codigo de
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

/** Los casos de negocio de este bloque, segun la tabla de la spec 10 §7.5. */
const NEGOCIO: ReadonlyArray<{ sentinel: string; errcode: string; error: () => AppError }> = [
  {
    // No existe, es de otra comunidad, esta borrada o un DRAFT que este actor no
    // gestiona. Las cuatro son el mismo 404 y por el mismo motivo (C-8): un 403
    // confirmaria que ese id existe (spec 10 §7.4).
    sentinel: 'vote_not_found',
    errcode: 'P0002',
    error: () => notFound('Esa votación no existe o no es visible.'),
  },
  {
    // El listado por un no-miembro o un PROVIDER (V-1, V-5). Mismo sentinel que
    // en los bloques 04-09 para el 403 de rol.
    sentinel: 'forbidden_role',
    errcode: '42501',
    error: () => forbidden('Tu rol en esta comunidad no permite esta acción.'),
  },
  {
    // Crear/editar/publicar/cerrar sin ser PRESIDENT ni ADMIN (V-1).
    sentinel: 'vote_requires_leadership',
    errcode: '42501',
    error: () => forbidden('Solo la presidencia o un administrador puede gestionar votaciones.'),
  },
  {
    // Resultados no visibles para este rol segun `result_visibility` (V-12).
    sentinel: 'vote_results_forbidden',
    errcode: '42501',
    error: () => forbidden('Los resultados de esta votación todavía no son visibles.'),
  },
  {
    // El PATCH o el publish de una votacion que ya no es DRAFT (V-7): un
    // publicado o cerrado es inmutable.
    sentinel: 'vote_not_draft',
    errcode: 'U0001',
    error: () => conflict('VOTE_NOT_DRAFT', 'Solo se puede editar o publicar un borrador.'),
  },
  {
    // Votar antes de `starts_at` o una votacion que no esta OPEN.
    sentinel: 'vote_not_open',
    errcode: 'U0001',
    error: () => conflict('VOTE_NOT_OPEN', 'La votación no está abierta.'),
  },
  {
    // Votar una votacion cuyo estado efectivo ya es CLOSED (por close o por
    // `ends_at`).
    sentinel: 'vote_closed',
    errcode: 'U0001',
    error: () => conflict('VOTE_CLOSED', 'La votación ya está cerrada.'),
  },
  {
    // Cerrar una votacion que ya esta CLOSED (incluida la vencida sin cerrar).
    sentinel: 'vote_already_closed',
    errcode: 'U0001',
    error: () => conflict('VOTE_ALREADY_CLOSED', 'La votación ya está cerrada.'),
  },
  {
    // Pedir los resultados de un DRAFT: no existen hasta publicar.
    sentinel: 'vote_not_published',
    errcode: 'U0001',
    error: () => conflict('VOTE_NOT_PUBLISHED', 'La votación todavía no se ha publicado.'),
  },
  {
    // Guarda interna del alta/edicion, inalcanzable desde la API (el zod exige
    // titulo/pregunta 1-120/200). Esta para una llamada directa.
    sentinel: 'vote_content_required',
    errcode: '22023',
    error: () => badRequest('El título y la pregunta son obligatorios.'),
  },
  {
    // Red para el CHECK votes_dates_valid; el superRefine del zod lo adelanta.
    sentinel: 'vote_dates_invalid',
    errcode: '22023',
    error: () => badRequest('La fecha de cierre debe ser posterior a la de inicio.'),
  },
  {
    // Red para el CHECK votes_quorum_valid (V-9).
    sentinel: 'vote_quorum_invalid',
    errcode: '22023',
    error: () => badRequest('El quórum debe estar entre 1 y 100.'),
  },
  {
    // Menos de dos opciones reales, o una vacia, o 'Abstención' mandada a mano
    // (V-10). El zod ya exige 2-20 cadenas no vacias; esto cubre el resto.
    sentinel: 'vote_options_invalid',
    errcode: '22023',
    error: () => badRequest('La votación necesita al menos dos opciones.'),
  },
  {
    // El `option_id` no es de esta votacion (la FK no lo comprueba). Codigo de
    // contrato propio (spec 10 §7.4).
    sentinel: 'vote_option_invalid',
    errcode: '22023',
    error: () => new AppError(400, 'VOTE_OPTION_INVALID', 'Esa opción no pertenece a esta votación.'),
  },
  {
    // Dos opciones iguales (comparadas en minusculas) o 'Abstención' escrita a
    // mano. Codigo de contrato propio.
    sentinel: 'vote_option_duplicate',
    errcode: '22023',
    error: () => new AppError(400, 'VOTE_OPTION_DUPLICATE', 'Hay opciones repetidas.'),
  },
  { sentinel: 'sin contexto de usuario', errcode: '42501', error: () => unauthorized() },
]

/**
 * Traduce un error de la base de datos al error de HTTP que le corresponde.
 * Devuelve `null` cuando el error no viene de PostgreSQL o no es un caso
 * conocido: quien llama lo vuelve a lanzar tal cual y el middleware de errores
 * lo acaba devolviendo como 500.
 */
export function translate(error: unknown): AppError | null {
  const origen = dePostgres(error)

  if (!origen) return null

  for (const caso of NEGOCIO) {
    if (origen.errcode === caso.errcode && origen.message.includes(caso.sentinel)) {
      return caso.error()
    }
  }

  // Sin sentinel, un 23505/U0001 NO se convierte en 409: los cinco conflictos del
  // bloque siempre viajan con su sentinel (ver cabecera).

  // CHECK de longitud o de dominio reventado en la tabla: 23514 sin sentinel
  // -> 400. El caso normal lo intercepta zod en la entrada; este es el plan B.
  if (origen.errcode === '23514') {
    return badRequest('Uno de los campos no cumple el formato permitido.')
  }

  // Enum, uuid o jsonb invalido: zod los valida antes, pero si llegaran...
  if (origen.errcode === '22P02') return badRequest('Uno de los valores enviados no es válido.')

  // 22023 sin sentinel: los que estas funciones saben levantar son problemas de
  // datos de entrada, asi que un 400 es la respuesta honesta.
  if (origen.errcode === '22023') return badRequest('Uno de los valores enviados no es válido.')

  // Sin sentinel conocido, 42501 sigue siendo inequivoco: si una politica de RLS
  // se cerrara de mas, el sintoma es un 403 y no un 500.
  if (origen.errcode === '42501') return forbidden()

  return null
}

/**
 * Ejecuta una accion y traduce sus errores de base de datos. Un `AppError` que
 * ya es del dominio pasa intacto: `translate` devuelve `null` y lo relanza.
 */
export async function ejecuta<T>(accion: () => Promise<T>): Promise<T> {
  try {
    return await accion()
  } catch (error) {
    throw translate(error) ?? error
  }
}
