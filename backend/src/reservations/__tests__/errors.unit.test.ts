// ---------------------------------------------------------------------------
// Traduccion de los errores de PL/pgSQL a HTTP (reservas).
//
// Tests unitarios, y aqui si que tienen sentido de una manera que no tienen en
// otro sitio del bloque: la traduccion se decide por un PAR, el `errcode` de
// Postgres y el sentinel del mensaje, y la combinacion de las dos se puede
// fabricar aqui.
//
// Por que importa. La regla de este bloque es que un sentinel NUNCA basta:
// hacen falta las dos cosas (R-12). Un sentinel es una cadena de texto que viaja
// dentro del mensaje, y el mensaje de Postgres es exactamente el sitio donde
// acabaria cualquier valor que venga del cliente — en este bloque, las `notes`
// de la propia reserva se interpolan en los mensajes de varias guardas. Si la
// traduccion mirase solo el texto, unas notas que empezaran por
// `reservation_not_found` podrian convertirse en un 404.
//
// Lo que se comprueba, entonces:
//
//   - El par correcto produce el codigo correcto (los tres 409, los ocho 400).
//   - El sentinel SIN su errcode no produce nada: un 23514 con el texto del
//     sentinel sigue siendo un 400 de formato, no un 409.
//   - El errcode SIN su sentinel tampoco.
//   - Los dos 22023 que son 409 (`not_pending`, `already_cancelled`) llegan
//     ANTES que el 22023 generico de 400: si no, una cancelacion dos veces
//     devolveria un 400 en vez del 409 que dice la spec (R-4).
//   - Un error que no viene de Postgres se devuelve tal cual (`translate` da
//     `null`).
// ---------------------------------------------------------------------------

import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { translate } from '../errors.js'

/** Un error de Prisma con el codigo de PostgreSQL en `meta`, como llega de verdad. */
function errorDePostgres(errcode: string, message: string): unknown {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code: 'P2010',
    clientVersion: 'test',
    meta: { code: errcode, message },
  })
}

describe('translate', () => {
  it('mapea el par (P0002, reservation_not_found) a un 404', () => {
    const error = translate(errorDePostgres('P0002', 'reservation_not_found: no existe o no es visible'))

    expect(error).not.toBeNull()
    expect(error?.status).toBe(404)
    expect(error?.code).toBe('NOT_FOUND')
  })

  it('mapea (P0002, area_not_found) a un 404 tambien', () => {
    // Alcanzable solo si alguien llamara a app_create_reservation() sin pasar
    // por requireCommonArea(); en la ruta normal el guard ya ha puesto 404.
    const error = translate(errorDePostgres('P0002', 'area_not_found: la zona no existe'))

    expect(error?.status).toBe(404)
  })

  it('mapea los dos 22023 que son 409 a un 409', () => {
    for (const sentinel of ['reservation_not_pending', 'reservation_already_cancelled']) {
      const error = translate(errorDePostgres('22023', `${sentinel}: la reserva no esta en ese estado`))

      expect(error?.status, `con ${sentinel}`).toBe(409)
      expect(error?.code, `con ${sentinel}`).toBe('CONFLICT')
    }
  })

  it('mapea el par (23505, reservation_slot_taken) a un 409', () => {
    // R-6, el corazon del bloque: dos peticiones disputando el mismo hueco y
    // el indice unico decidindo. El 409 es la unica respuesta posible.
    const error = translate(errorDePostgres('23505', 'reservation_slot_taken: ya hay una reserva en ese hueco'))

    expect(error?.status).toBe(409)
    expect(error?.code).toBe('CONFLICT')
  })

  it('mapea los ocho 22023 de R-7 a un 400', () => {
    const CUATROCIENTOS = [
      'reservation_outside_hours',
      'reservation_misaligned',
      'reservation_in_the_past',
      'reservation_area_inactive',
      'reservation_capacity_exceeded',
      'reservation_daily_limit',
      'reservation_invalid_range',
    ]

    for (const sentinel of CUATROCIENTOS) {
      const error = translate(errorDePostgres('22023', `${sentinel}: datos de entrada`))

      expect(error?.status, `con ${sentinel}`).toBe(400)
    }
  })

  it('mapea (42501, forbidden_role) a un 403', () => {
    const error = translate(errorDePostgres('42501', 'forbidden_role: rol insuficiente'))

    expect(error?.status).toBe(403)
  })

  it('mapea la falta de contexto de usuario a un 401', () => {
    const error = translate(errorDePostgres('42501', 'sin contexto de usuario'))

    expect(error?.status).toBe(401)
  })

  // El caso que motiva todo este archivo.
  it('un sentinel SIN su errcode no se convierte en el error de negocio', () => {
    // 23514 con el texto del sentinel de hueco ocupado. Si la traduccion
    // mirase solo el mensaje, esto seria un 409 y el cliente diria "horario
    // ocupado" cuando en realidad es un CHECK de la tabla reventado.
    const error = translate(errorDePostgres('23514', 'reservation_slot_taken: violates check constraint'))

    expect(error?.status).toBe(400)
    expect(error?.code).toBe('VALIDATION_ERROR')
  })

  it('un sentinel con un errcode de otro tipo tampoco se mezcla con otro caso', () => {
    // El sentinel de "no encontrado" con un 22023 NO es un 404: el par no
    // coincide. Cae en el fallback generico de 22023, que es un 400 — y es la
    // respuesta honesta: 22023 es "invalid_parameter", un problema de datos de
    // entrada, venga con el sentinel que venga. Lo que NO puede pasar es que
    // sea un 404.
    const con22023 = translate(errorDePostgres('22023', 'reservation_not_found: lo que sea'))
    expect(con22023?.status).toBe(400)

    // Y con un 23505, el fallback generico lo convierte en un 409 generico,
    // que sigue siendo honesto: es un conflicto de unicidad aunque el sentinel
    // no sea el esperado.
    const con23505 = translate(errorDePostgres('23505', 'reservation_not_found: lo que sea'))
    expect(con23505?.status).toBe(409)
  })

  it('un 22023 sin sentinel conocido es un 400', () => {
    // Los ocho con nombre ya estan arriba; lo que quede es de datos de
    // entrada.
    const error = translate(errorDePostgres('22023', 'invalid_parameter_value'))

    expect(error?.status).toBe(400)
  })

  it('un 23505 sin sentinel conocido sigue siendo un 409', () => {
    const error = translate(errorDePostgres('23505', 'duplicate key value violates unique constraint'))

    expect(error?.status).toBe(409)
  })

  it('un 42501 sin sentinel conocido es un 403 y no un 500', () => {
    const error = translate(errorDePostgres('42501', 'new row violates row-level security policy'))

    expect(error?.status).toBe(403)
  })

  it('un 22P02 es un 400, no un 500', () => {
    const error = translate(errorDePostgres('22P02', 'invalid input syntax for type uuid'))

    expect(error?.status).toBe(400)
  })

  it('devuelve null si el error no viene de PostgreSQL', () => {
    expect(translate(new Error('fallo de Javascript'))).toBeNull()
    expect(translate('una cadena')).toBeNull()
    expect(translate(undefined)).toBeNull()
  })

  it('devuelve null si viene de Prisma pero no de una consulta en crudo', () => {
    const otro = new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' })

    expect(translate(otro)).toBeNull()
  })

  it('devuelve null si el error de Postgres no es ninguno de los casos conocidos', () => {
    expect(translate(errorDePostgres('53200', 'out of memory'))).toBeNull()
    expect(translate(errorDePostgres('XX000', 'error interno de la base de datos'))).toBeNull()
  })
})
