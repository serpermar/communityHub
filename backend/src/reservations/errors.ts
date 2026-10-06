// ---------------------------------------------------------------------------
// Del sentinel de PL/pgSQL al error HTTP.
//
// Las funciones de 02g_reservations.sql levantan los casos de negocio con un
// sentinel al principio del mensaje ('reservation_not_found: ...') y un
// `errcode` de Postgres. Este archivo es el unico sitio que sabe traducirlos, y
// el unico que decide que un 42501 es un 403 y no un 500.
//
// Por que el mapeo vive aqui y no en el mensaje de la base de datos: el mensaje
// de Postgres esta escrito para alguien depurando en un terminal, y su texto
// depende del idioma de la sesion. Lo que no cambia nunca son el `errcode` y el
// sentinel.
//
// Y por eso se exige EL PAR de las dos y no solo el sentinel (R-12): un
// sentinel es una cadena de texto, y cualquier valor que venga del cliente
// puede acabar dentro del mensaje de un error de Postgres. Con el par, un
// `notes` que se llamase `reservation_not_found` no puede convertirse en un
// 404.
//
// Nota sobre los `22023`: seis sentinels de este bloque los usan para 400 y
// otros dos para 409 (`reservation_not_pending`, `reservation_already_cancelled`).
// Por eso el 409 esta primero: los casos con nombre se resuelven en el bucle, y
// el `22023` generico de abajo solo alcanza a los que no tienen nombre, que son
// siempre problemas de datos de entrada.
// ---------------------------------------------------------------------------

import { Prisma } from '@prisma/client'
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from '../http/errors.js'

/** El `errcode` y el mensaje que PostgreSQL trae al cliente de Prisma. */
type Origen = { errcode: string; message: string }

/**
 * Saca el par (errcode, mensaje) de un fallo de `$queryRaw` / `$executeRaw`.
 *
 * Un fallo de una consulta en crudo SIEMPRE llega como `P2010`, con el codigo
 * de PostgreSQL en `meta.code` y no en `message`. Es el mismo camino que
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
 * Los casos de negocio de este bloque (spec 06 §7.5).
 *
 * El orden NO importa entre sentinels distintos: solo uno puede aparecer en un
 * mensaje.
 */
const NEGOCIO: ReadonlyArray<{ sentinel: string; errcode: string; error: () => AppError }> = [
  {
    // La reserva no existe, no es visible o la comunidad ya no es suya. Las
    // tres son el mismo 404 y por el mismo motivo (C-8): un 403 confirmaria
    // que ese id existe.
    sentinel: 'reservation_not_found',
    errcode: 'P0002',
    error: () => notFound('Esa reserva no existe.'),
  },
  {
    // Mismo par que en la spec 05, alcanzable solo si alguien llamara a
    // app_create_reservation() sin pasar por requireCommonArea(). En la ruta
    // normal, el guard ya ha puesto 404 antes.
    sentinel: 'area_not_found',
    errcode: 'P0002',
    error: () => notFound('Esa zona común no existe.'),
  },
  {
    // Confirmar una CONFIRMED o una CANCELLED (R-3). 409 y no 404: la reserva
    // es visible para el actor, esconderla detras de un 404 seria mentir.
    sentinel: 'reservation_not_pending',
    errcode: '22023',
    error: () => conflict('CONFLICT', 'La reserva no está pendiente de confirmación.'),
  },
  {
    // Cancelar dos veces (R-4). 409 y no un no-op: la segunda no cambia nada,
    // y un 200 sin efecto dejaria al cliente sin saber si su primera
    // cancelacion llego.
    sentinel: 'reservation_already_cancelled',
    errcode: '22023',
    error: () => conflict('CONFLICT', 'Esa reserva ya está cancelada.'),
  },
  {
    // R-6, el corazon del bloque: dos peticiones disputando el mismo hueco, y
    // el indice unico decide. El 409 es la unica respuesta posible —el
    // cliente no puede "arreglar" nada, solo elegir otra hora.
    sentinel: 'reservation_slot_taken',
    errcode: '23505',
    error: () => conflict('CONFLICT', 'Ese horario ya está ocupado por otra reserva.'),
  },
  {
    // Las seis de 400 (R-7). Todas son datos del formulario que se pueden
    // corregir sin permisos, y por eso 400 y no 403 ni 409. El orden de la
    // funcion hace que la que vea quien llama sea la mas especifica.
    sentinel: 'reservation_outside_hours',
    errcode: '22023',
    error: () => badRequest('La reserva cae fuera del horario de la zona.'),
  },
  {
    sentinel: 'reservation_misaligned',
    errcode: '22023',
    error: () => badRequest('Las horas deben encajar en la rejilla de reservas de la zona.'),
  },
  {
    sentinel: 'reservation_in_the_past',
    errcode: '22023',
    error: () => badRequest('La reserva no puede empezar en el pasado.'),
  },
  {
    sentinel: 'reservation_area_inactive',
    errcode: '22023',
    error: () => badRequest('Esa zona común está dada de baja y no admite reservas.'),
  },
  {
    sentinel: 'reservation_capacity_exceeded',
    errcode: '22023',
    error: () => badRequest('La asistencia supera la capacidad de la zona.'),
  },
  {
    sentinel: 'reservation_daily_limit',
    errcode: '22023',
    error: () => badRequest('Se ha alcanzado el límite diario de reservas de esa zona.'),
  },
  {
    // Guarda interna de la funcion (el CHECK de la tabla daria 23514). En la
    // practica zod la intercepta antes con el mismo mensaje, asi que esta es
    // la red por si alguien llama a la funcion sin pasar por el controller.
    sentinel: 'reservation_invalid_range',
    errcode: '22023',
    error: () => badRequest('El fin de la reserva debe ser posterior al inicio.'),
  },
  {
    // R-1: PROVIDER o suspendido reservando, PRESIDENT confirmando o
    // cancelando ajena, no miembro. Todos "el rol no da para esto".
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

  // Un 23505 sin sentinel conocido sigue siendo un conflicto de unicidad. El
  // caso normal (`area_slots_no_overlap_uidx`) llega con su sentinel; este
  // fallback cubre cualquier otro indice que reviente un dia.
  if (origen.errcode === '23505') {
    return conflict('CONFLICT', 'Ese valor ya está en uso.')
  }

  // CHECK de la tabla reventado (23514) o enum/uuid invalido (22P02): 400, un
  // formulario mal rellenado. En una teoria zod los intercepta antes.
  if (origen.errcode === '23514') return badRequest('Uno de los campos no cumple el formato permitido.')
  if (origen.errcode === '22P02') return badRequest('Uno de los valores enviados no es válido.')

  // 22023 sin sentinel: los ocho con nombre ya estan arriba, asi que lo que
  // quede es de datos de entrada.
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
