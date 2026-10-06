// ---------------------------------------------------------------------------
// Del sentinel de PL/pgSQL al error HTTP.
//
// Las funciones de 02f_common_areas.sql levantan los casos de negocio con un
// sentinel al principio del mensaje ('area_not_found: ...') y un `errcode` de
// Postgres. Este archivo es el unico sitio que sabe traducirlos, y el unico que
// decide que un 42501 es un 403 y no un 500.
//
// Por que el mapeo vive aqui y no en el mensaje de la base de datos: el mensaje
// de Postgres esta escrito para alguien depurando en un terminal, y su texto
// depende del idioma de la sesion. Lo que no cambia nunca son el `errcode` y el
// sentinel.
//
// Y por eso se exige EL PAR de las dos y no solo el sentinel (spec 05 7.5): un
// sentinel es una cadena de texto, y cualquier valor que venga del cliente puede
// acabar dentro del mensaje de un error de Postgres. Con el par, un nombre de
// zona que se llamase `area_not_found` no puede convertirse en un 404.
//
// Los dos `22023` de esta tabla (`area_name_required`, `area_date_required`) son
// guardas internas de las funciones, inalcanzables desde la API porque zod
// exige `name` y `date` antes. Estan igualmente: si algun dia se llamara a la
// funcion desde otro sitio, el fallo seria un 400 legible y no un 500.
// ---------------------------------------------------------------------------

import { Prisma } from '@prisma/client'
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from '../http/errors.js'

/** El `errcode` y el mensaje que PostgreSQL trae al cliente de Prisma. */
type Origen = { errcode: string; message: string }

/**
 * Saca el par (errcode, mensaje) de un fallo de `$queryRaw` / `$executeRaw`.
 *
 * Un fallo de una consulta en crudo SIEMPRE llega como `P2010`, con el codigo de
 * PostgreSQL en `meta.code` y no en `message`. Es el mismo camino que
 * `members/errors.ts` e `incidents/errors.ts`.
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
 * aparecer en un mensaje.
 */
const NEGOCIO: ReadonlyArray<{ sentinel: string; errcode: string; error: () => AppError }> = [
  {
    // La zona no existe, no es visible para este actor o la comunidad es de
    // otro. Las tres son el mismo 404 y por el mismo motivo (C-8): un 403
    // confirmaria que ese id existe.
    sentinel: 'area_not_found',
    errcode: 'P0002',
    error: () => notFound('Esa zona común no existe.'),
  },
  {
    // El indice unico del nombre por comunidad (CA-2), traducido dentro de la
    // funcion con este sentinel. 409 y no 400: el dato del formulario es
    // valido, lo que pasa es que ya lo usa otro. La accion no es "corregir el
    // campo" sino elegir otro nombre.
    sentinel: 'area_name_taken',
    errcode: '23505',
    error: () => conflict('CONFLICT', 'Ya existe una zona con ese nombre en esta comunidad.'),
  },
  {
    // Guarda interna, inalcanzable desde la API (zod exige name).
    sentinel: 'area_name_required',
    errcode: '22023',
    error: () => badRequest('El nombre es obligatorio.'),
  },
  {
    // Guarda interna de la disponibilidad, inalcanzable (zod exige date).
    sentinel: 'area_date_required',
    errcode: '22023',
    error: () => badRequest('La fecha es obligatoria.'),
  },
  {
    // El POST por un no-ADMIN, el PUT por un no-ADMIN y cualquier otra funcion
    // llamada con un rol que no da para esto.
    sentinel: 'forbidden_role',
    errcode: '42501',
    error: () => forbidden('Tu rol en esta comunidad no permite esta acción.'),
  },
  { sentinel: 'sin contexto de usuario', errcode: '42501', error: () => unauthorized() },
]

/**
 * Traduce un error de la base de datos al error de HTTP que le corresponde.
 *
 * Devuelve `null` cuando el error no viene de PostgreSQL o no es ninguno de los
 * casos conocidos. `null` significa "este error no es mio": quien llama lo vuelve
 * a lanzar tal cual, y el middleware de errores lo acaba devolver como 500.
 */
export function translate(error: unknown): AppError | null {
  const origen = dePostgres(error)

  if (!origen) return null

  for (const caso of NEGOCIO) {
    if (origen.errcode === caso.errcode && origen.message.includes(caso.sentinel)) {
      return caso.error()
    }
  }

  // Nombre duplicado por el indice, sin sentinel: el caso normal viaja con
  // `area_name_taken`, pero si un dia cambiara el nombre del indice el 409 no
  // deberia degradarse a 500. Un 23505 es siempre un conflicto de unicidad.
  if (origen.errcode === '23505') {
    return conflict('CONFLICT', 'Ese valor ya está en uso.')
  }

  // CHECK de longitud o de horario reventado en la tabla: 23514 sin sentinel.
  // 400, porque es un formulario mal rellenado.
  if (origen.errcode === '23514') {
    return badRequest('Uno de los campos no cumple el formato permitido.')
  }

  // Enum o uuid invalido. En una teoria no deberia llegar: zod los valida antes.
  if (origen.errcode === '22P02') return badRequest('Uno de los valores enviados no es válido.')

  // 22023 sin sentinel: todos los que estas funciones saben levantar son
  // problemas de datos de entrada (las dos guardas de arriba), asi que un 400
  // es la respuesta honesta.
  if (origen.errcode === '22023') return badRequest('Uno de los valores enviados no es válido.')

  // Sin sentinel conocido, 42501 sigue siendo inequivoco: si algun dia una
  // politica de RLS se cierra de mas, el sintoma es un 403 y no un 500.
  if (origen.errcode === '42501') return forbidden()

  return null
}

/**
 * Ejecuta una accion y traduce sus errores de base de datos.
 *
 * Es la forma de no repetir el try/catch en cada funcion del servicio. Un
 * `AppError` que ya es del dominio pasa intacto: `translate` devuelve `null` y
 * lo vuelve a lanzar.
 */
export async function ejecuta<T>(accion: () => Promise<T>): Promise<T> {
  try {
    return await accion()
  } catch (error) {
    throw translate(error) ?? error
  }
}
