// ---------------------------------------------------------------------------
// Del sentinel de PL/pgSQL al error HTTP.
//
// Las funciones de 02h_announcements.sql levantan los casos de negocio con un
// sentinel al principio del mensaje ('announcement_not_found: ...') y un
// `errcode` de Postgres. Este archivo es el unico sitio que sabe traducirlos, y
// el unico que decide que un 42501 es un 403 y no un 500.
//
// Por que el mapeo vive aqui y no en el mensaje de la base de datos: el mensaje
// de Postgres esta escrito para alguien depurando en un terminal, y su texto
// depende del idioma de la sesion. Lo que no cambia nunca son el `errcode` y el
// sentinel.
//
// Y por eso se exige EL PAR de las dos y no solo el sentinel (spec 05 7.5): un
// sentinel es una cadena de texto, y cualquier valor que venga del cliente puede
// acabar dentro del mensaje de un error de Postgres. Con el par, un cuerpo que
// se llamase `announcement_not_found` no puede convertirse en un 404.
//
// NO hay 409 en este modulo (AN-11): `announcements` no tiene ningun indice
// unico mas alla de la clave primaria, asi que un 23505 no puede ocurrir por un
// dato del cliente. Por eso la traduccion de `conflict` de `common-areas/errors.ts`
// no se copia aqui: si un dia apareciera un 23505, seria un bug del esquema, y
// convertirlo en un 409 lo disfrazaria de comportamiento previsto. Se deja
// caer como 500 para que se vea.
// ---------------------------------------------------------------------------

import { Prisma } from '@prisma/client'
import { AppError, badRequest, forbidden, notFound, unauthorized } from '../http/errors.js'

/** El `errcode` y el mensaje que PostgreSQL trae al cliente de Prisma. */
type Origen = { errcode: string; message: string }

/**
 * Saca el par (errcode, mensaje) de un fallo de `$queryRaw` / `$executeRaw`.
 *
 * Un fallo de una consulta en crudo SIEMPRE llega como `P2010`, con el codigo de
 * PostgreSQL en `meta.code` y no en `message`. Es el mismo camino que
 * `members/errors.ts`, `incidents/errors.ts` y `common-areas/errors.ts`.
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
    // El aviso no existe, no es visible para este actor, esta borrado o es de
    // otra comunidad. Las cuatro son el mismo 404 y por el mismo motivo (C-8):
    // un 403 confirmaria que ese id existe. Nota que aqui solo llega desde
    // relecturas (`app_list_announcements` con id): el middleware ya tradujo el
    // 404 del `app_announcement_community()` antes de entrar en la transaccion.
    sentinel: 'announcement_not_found',
    errcode: 'P0002',
    error: () => notFound('Ese aviso no existe.'),
  },
  {
    // El POST o el PUT por un rol que no da para liderazgo. `announcement_requires_admin`
    // se ignora aqui a proposit: es el caso del borrado y tiene mensaje propio.
    sentinel: 'forbidden_role',
    errcode: '42501',
    error: () => forbidden('Tu rol en esta comunidad no permite esta acción.'),
  },
  {
    // El DELETE por un PRESIDENT: el borrado es exclusivo de ADMIN (AN-1/AN-5).
    // Mensaje propio porque "no tienes permiso" y "borrar es solo de admin" son
    // dos respuestas distintas para el cliente, y el segundo le dice si le
    // compensa pedirle a un ADMIN que lo borre.
    sentinel: 'announcement_requires_admin',
    errcode: '42501',
    error: () => forbidden('Solo un administrador puede borrar avisos.'),
  },
  {
    // Guarda interna de `app_create_announcement()`, inalcanzable desde la API
    // porque zod exige title y body antes. Esta igualmente: si algun dia se
    // llamara a la funcion desde otro sitio, el fallo seria un 400 legible.
    sentinel: 'announcement_content_required',
    errcode: '22023',
    error: () => badRequest('El título y el cuerpo son obligatorios.'),
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

  // Sin 23505 aqui, y no por olvido: ver la cabecera de este archivo (AN-11).

  // CHECK de longitud o de fechas reventado en la tabla: 23514 sin sentinel.
  // 400, porque es un formulario mal rellenado. El caso normal lo intercepta
  // zod en la entrada; este es el plan B de seguridad.
  if (origen.errcode === '23514') {
    return badRequest('Uno de los campos no cumple el formato permitido.')
  }

  // Enum o uuid invalido. En una teoria no deberia llegar: zod los valida antes.
  if (origen.errcode === '22P02') return badRequest('Uno de los valores enviados no es válido.')

  // 22023 sin sentinel: todos los que estas funciones saben levantar son
  // problemas de datos de entrada (la guarda de arriba), asi que un 400 es la
  // respuesta honesta.
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
