// ---------------------------------------------------------------------------
// Del sentinel de PL/pgSQL al error HTTP.
//
// Las funciones de 02d_members.sql levantan los casos de negocio con un sentinel
// al principio del mensaje ('member_last_admin: ...') y un `errcode` de Postgres.
// Este archivo es el unico sitio que sabe traducirlos, y el unico que decide que
// un 42501 es un 403 y no un 500.
//
// Por que el mapeo vive aqui y no en el mensaje de la base de datos: el mensaje
// de Postgres esta escrito para alguien depurando en un terminal, y su texto
// depende del idioma de la sesion. Lo que no cambia nunca son el `errcode` y el
// sentinel. Aqui se usan las dos cosas, no una.
//
// Y por que se exige EL PAR de las dos y no solo el sentinel: un sentinel es una
// cadena de texto, y cualquier valor que venga del cliente puede acabar dentro
// del mensaje de un error de Postgres. Con el par, un email que se llamase
// `member_last_admin` no puede convertirse en un 409.
//
// `invitation_used` e `invitation_expired` se traducen al MISMO error a
// proposito. La spec (seccion 5) quiere distinguirlos DENTRO para poder escribir
// dos tests distintos, pero desde fuera las dos son "este codigo no sirve" con un
// 400. Separarlas hacia mensajes distintos confirmaria a quien prueba codigos
// ajenos si uno existe pero caducado, que es informacion sobre otra comunidad.
// ---------------------------------------------------------------------------

import { Prisma } from '@prisma/client'
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from '../http/errors.js'

/** El `errcode` y el mensaje que PostgreSQL trae al cliente de Prisma. */
type Origen = { errcode: string; message: string }

/**
 * Saca el par (errcode, mensaje) de un fallo de `$queryRaw` / `$executeRaw`.
 *
 * Un fallo de una consulta en crudo SIEMPRE llega como `P2010`, con el codigo de
 * PostgreSQL en `meta.code` y no en `message`. Es lo mismo que hace
 * `communities/service.ts` con el slug duplicado, y por el mismo motivo.
 */
function dePostgres(error: unknown): Origen | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null
  if (error.code !== 'P2010') return null

  const errcode = error.meta?.code
  const message = error.meta?.message

  if (typeof errcode !== 'string' || typeof message !== 'string') return null

  return { errcode, message }
}

/**
 * Los casos de negocio de este bloque.
 *
 * El orden NO importa: los sentinel son distintos entre si y solo uno puede
 * aparecer en un mensaje. Se listan de la respuesta mas rara a la mas comun.
 */
const NEGOCIO: ReadonlyArray<{ sentinel: string; errcode: string; error: () => AppError }> = [
  {
    // La membresia existe, pero no en ESTA comunidad: se busca por (community_id,
    // member_id). Por eso un ADMIN de A con un memberId de B recibe 404 y no 403
    // (spec 03, seccion 6).
    sentinel: 'member_not_found',
    errcode: 'P0002',
    error: () => notFound('Ese miembro no existe en esta comunidad.'),
  },
  {
    // M-3. Da 409 y no 403 porque no es un problema de permiso: el ADMIN puede,
    // lo que le falta es otro ADMIN. Un 403 diria "no puedes" y el cliente
    // mostraria un error sin accion posible.
    sentinel: 'member_last_admin',
    errcode: '23514',
    error: () => conflict('CONFLICT', 'Hay que promover a otro ADMIN antes de cambiar al último.'),
  },
  {
    sentinel: 'invitation_email_mismatch',
    errcode: '42501',
    // 403 y no 400 por el motivo de C-8: un 400 con "este código es de otro
    // correo" confirmaría que el código existe.
    error: () => forbidden('No puedes canjear este código.'),
  },
  {
    // Los dos casos de un codigo inservible. Mismo error, mismo texto: quien lo
    // prueba no tiene por que saber cual de los dos es.
    sentinel: 'invitation_used',
    errcode: '22023',
    error: () => badRequest('El código no es válido o ya ha caducado.'),
  },
  {
    sentinel: 'invitation_expired',
    errcode: '22023',
    error: () => badRequest('El código no es válido o ya ha caducado.'),
  },

  // Guardas internas de las funciones. Con los guards del middleware no deberían
  // ser alcanzables desde la API: están para que un fallo ahi sea un 403 legible
  // en vez de un 500, y para que el SQL siga siendo correcto si alguien lo llama
  // desde otro sitio.
  { sentinel: 'solo un ADMIN', errcode: '42501', error: () => forbidden('Tu rol en esta comunidad no permite esta acción.') },
  { sentinel: 'no es miembro de la comunidad', errcode: '42501', error: () => forbidden('No perteneces a esta comunidad.') },
  { sentinel: 'sin contexto de usuario', errcode: '42501', error: () => unauthorized() },
  { sentinel: 'email invalido', errcode: '22023', error: () => badRequest('El correo no tiene un formato válido.') },
  { sentinel: 'el codigo es obligatorio', errcode: '22023', error: () => badRequest('El código es obligatorio.') },
  { sentinel: 'el rol es obligatorio', errcode: '22023', error: () => badRequest('El rol es obligatorio.') },
  { sentinel: 'el estado es obligatorio', errcode: '22023', error: () => badRequest('El estado es obligatorio.') },
]

/**
 * Cual de los dos conflictos de unicidad es, cuando llega un `23505`.
 *
 * El sentinel NO puede decidir esto, y no es una preferencia: Prisma reescribe el
 * mensaje de PostgreSQL cuando el SQLSTATE es `23505` y lo sustituye por su
 * texto generico de unicidad. Un `raise exception 'invitation_live: ...' using
 * errcode = '23505'` llega aqui como
 *
 *     P2010 · meta.code = '23505' · meta.message = 'Unique constraint failed: '
 *
 * con el sentinel borrado. Por eso estos dos casos NO estan en `NEGOCIO`, y por
 * eso sedecidedn por quien llama: cada funcion de SQL tiene UN solo `23505`
 * posible, `app_invite_to_community` solo puede chocar con la invitacion viva y
 * `app_redeem_invitation` solo con el "ya eres miembro". El `errcode` basta para
 * saber que hay conflicto, y la funcion que se ejecuto basta para saber cual.
 *
 * Los dos dan 409 `CONFLICT`, que es lo que pide la spec (seccion 7); lo que cambia
 * es el texto, para que el cliente sepa si tiene que anular una invitacion o
 * simplemente dejar de canjear codigos.
 */
export type Conflicto =
  | 'invitacion_viva'
  | 'ya_es_miembro_activo'

const CONFLICTO: Readonly<Record<Conflicto, () => AppError>> = {
  invitacion_viva: () =>
    conflict('CONFLICT', 'Ya hay una invitación viva para ese correo. Anúlala antes de crear otra.'),
  ya_es_miembro_activo: () => conflict('CONFLICT', 'Ya eres miembro activo de esta comunidad.'),
}

/**
 * Traduce un error de la base de datos al error de HTTP que le corresponde.
 *
 * Devuelve `null` cuando el error no viene de PostgreSQL o no es ninguno de los
 * casos conocidos. `null` significa "este error no es mio": quien llama lo vuelve
 * a lanzar tal cual, y el middleware de errores lo acaba devolver como 500, que
 * es lo que corresponde a un fallo no previsto.
 *
 * Que un `42501` desconocido sea un 403 y no un 500 tiene una lectura util: si
 * algun dia una politica de RLS se cierra de mas, el sintoma es un 403 en vez de
 * un error interno que nadie sabe mirar.
 *
 * `conflito` es opcional y solo se mira cuando el `errcode` es `23505`, donde el
 * sentinel ya no es legible (ver `Conflicto`). Sin el, un `23505` que nadie ha
 * identificado se devuelve como un 409 generico en vez de como un 500: un 23505
 * es siempre un conflicto en este dominio, y un 500 seria mentir sobre un
 * rechazo previsto.
 */
export function translate(error: unknown, conflicto?: Conflicto): AppError | null {
  const origen = dePostgres(error)

  if (!origen) return null

  for (const caso of NEGOCIO) {
    if (origen.errcode === caso.errcode && origen.message.includes(caso.sentinel)) {
      return caso.error()
    }
  }

  if (origen.errcode === '23505') {
    return conflicto ? CONFLICTO[conflicto]() : conflict('CONFLICT', 'Ese registro ya existe.')
  }

  // Sin sentinel conocido, algunos errcode siguen siendo inequivocos.
  if (origen.errcode === '42501') return forbidden()
  if (origen.errcode === '22P02') return badRequest('Uno de los valores enviados no es válido.')

  return null
}

/**
 * Ejecuta una accion y traduce sus errores de base de datos.
 *
 * Es la forma de no repetir el try/catch en cada funcion del servicio. Un
 * `AppError` que ya es del dominio pasa intacto: `translate` devuelve `null` y lo
 * vuelve a lanzar.
 */
export async function ejecuta<T>(accion: () => Promise<T>, conflicto?: Conflicto): Promise<T> {
  try {
    return await accion()
  } catch (error) {
    throw translate(error, conflicto) ?? error
  }
}