// ---------------------------------------------------------------------------
// Del sentinel de PL/pgSQL al error HTTP.
//
// Las funciones de 02e_incidents.sql levantan los casos de negocio con un sentinel
// al principio del mensaje ('incident_not_found: ...') y un `errcode` de Postgres.
// Este archivo es el unico sitio que sabe traducirlos, y el unico que decide que
// un 42501 es un 403 y no un 500.
//
// Por que el mapeo vive aqui y no en el mensaje de la base de datos: el mensaje de
// Postgres esta escrito para alguien depurando en un terminal, y su texto depende
// del idioma de la sesion. Lo que no cambia nunca son el `errcode` y el sentinel.
//
// Y por eso se exige EL PAR de las dos y no solo el sentinel: un sentinel es una
// cadena de texto, y cualquier valor que venga del cliente puede acabar dentro del
// mensaje de un error de Postgres. Con el par, un titulo que se llamase
// `incident_invalid_transition` no puede convertirse en un 409.
//
// Un detalle que no es cosmetico:
//
//   `incident_invalid_transition` usa 22023, NO 23514.
//
// Las dos cosas son `CHECK` reventados de la misma tabla (los CHECK de longitud se
// anaden en 02e), asi que con 23514 para las dos un titulo de tres letras y una
// transicion imposible solo se distinguen por el sentinel DENTRO del mensaje. Y si
// un dia Prisma reescribe ese mensaje, el titulo corto sale como 409 y el vecino ve
// "no se puede cambiar el estado" de un POST. Con 22023 los dos ocupan errcode
// distintos y son inequivocos aunque el texto se pierda.
//
// Y por eso el `23514` sin sentinel es un 400 y no un 409: es lo que devuelve la
// base de datos cuando un CHECK de longitud salta, es decir un formulario mal
// rellenado, que es exactamente lo que es.
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
 * `members/errors.ts`.
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
    // La incidencia existe pero NO es visible para este actor, o no existe, o esta
    // borrada logicamente. Las tres son la misma respuesta y por el mismo motivo
    // (C-8): un 403 confirmaria que ese id existe. Un 410 tampoco, porque para el
    // cliente no existe: el borrado logico es invisible por diseno.
    sentinel: 'incident_not_found',
    errcode: 'P0002',
    error: () => notFound('Esa incidencia no existe.'),
  },
  {
    // I-3, I-4, D-4 y el grafo de 5.6. Da 409 y no 403 porque el problema no es de
    // permiso: si el actor pasa el guard de rol, lo que le falta es una
    // transicion valida. Un 403 diria "no puedes" y el cliente mostraria un error
    // sin accion posible, cuando lo que tiene que hacer es elegir otro estado.
    sentinel: 'incident_invalid_transition',
    errcode: '22023',
    error: () => conflict('CONFLICT', 'Ese cambio de estado no está permitido desde el estado actual.'),
  },
  {
    // `assignedToId` que no es un PROVIDER activo de la MISMA comunidad. 400 y no
    // 404 ni 403: el id es real, el problema es que no sirve para este campo, y es un
    // dato del formulario que se puede corregir sin permisos.
    sentinel: 'incident_assignee_not_provider',
    errcode: '22023',
    error: () => badRequest('Ese usuario no es un proveedor activo de esta comunidad.'),
  },
  {
    sentinel: 'incident_priority_required',
    errcode: '22023',
    error: () => badRequest('La prioridad es obligatoria.'),
  },

  // Guardas internas de las funciones. Con los guards del middleware no deberían ser
  // alcanzables desde la API: están para que un fallo ahi sea un 403 legible en vez
  // de un 500, y para que el SQL siga siendo correcto si alguien lo llama desde otro
  // sitio.
  {
    // I-8 (prioridad) e I-4 (asignar) y el borrado: los tres son de ADMIN, y el
    // sentinel es el mismo para que el mensaje sea uno solo y no tres variantes de
    // "no puedes".
    sentinel: 'incident_requires_admin',
    errcode: '42501',
    error: () => forbidden('Tu rol en esta comunidad no permite esta acción.'),
  },
  {
    // El reporter que no edita la suya, el vecino que cambia el estado y el
    // PRESIDENT que lo intenta (D-4). Los tres son "el rol no da para esto".
    sentinel: 'forbidden_role',
    errcode: '42501',
    error: () => forbidden('Tu rol en esta comunidad no permite esta acción.'),
  },
  { sentinel: 'sin contexto de usuario', errcode: '42501', error: () => unauthorized() },
]

/**
 * Traduce un error de la base de datos al error de HTTP que le corresponde.
 *
 * Devuelve `null` cuando el error no viene de PostgreSQL o no es ninguno de los casos
 * conocidos. `null` significa "este error no es mio": quien llama lo vuelve a lanzar
 * tal cual, y el middleware de errores lo acaba devolver como 500.
 *
 * Que un `42501` desconocido sea un 403 y no un 500 tiene una lectura util: si algun
 * dia una politica de RLS se cierra de mas, el sintoma es un 403 en vez de un error
 * interno que nadie sabe mirar.
 */
export function translate(error: unknown): AppError | null {
  const origen = dePostgres(error)

  if (!origen) return null

  for (const caso of NEGOCIO) {
    if (origen.errcode === caso.errcode && origen.message.includes(caso.sentinel)) {
      return caso.error()
    }
  }

  // CHECK de longitud reventado en la tabla: 23514 sin sentinel. 400, porque un
  // titulo de tres letras es un formulario mal rellenado y no un problema de estado.
  if (origen.errcode === '23514') {
    return badRequest('Uno de los campos no cumple la longitud permitida.')
  }

  // Enum o uuid invalido. En una teoria no deberia llegar: zod los valida antes. Si
  // llega, es que alguien llamo al servicio sin pasar por el controller, y un 400
  // honesto es mejor que un 500.
  if (origen.errcode === '22P02') return badRequest('Uno de los valores enviados no es válido.')

  // Sin sentinel conocido, 42501 sigue siendo inequivoco.
  if (origen.errcode === '42501') return forbidden()

  return null
}

/**
 * Ejecuta una accion y traduce sus errores de base de datos.
 *
 * Es la forma de no repetir el try/catch en cada funcion del servicio. Un `AppError`
 * que ya es del dominio pasa intacto: `translate` devuelve `null` y lo vuelve a
 * lanzar.
 */
export async function ejecuta<T>(accion: () => Promise<T>): Promise<T> {
  try {
    return await accion()
  } catch (error) {
    throw translate(error) ?? error
  }
}