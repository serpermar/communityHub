// ---------------------------------------------------------------------------
// Traduccion de los errores de PL/pgSQL a HTTP (zonas comunes).
//
// Tests unitarios, y aqui si que tienen sentido de una manera que no tienen en
// otro sitio del bloque: la traduccion se decide por un PAR, el `errcode` de
// Postgres y el sentinel del mensaje, y la combinacion de las dos se puede
// fabricar aqui.
//
// Por que importa. La regla de este bloque es que un sentinel NUNCA basta:
// hacen falta las dos cosas (spec 05 7.5). Un sentinel es una cadena de texto
// que viaja dentro del mensaje, y el mensaje de Postgres es exactamente el
// sitio donde acabaria cualquier valor que venga del cliente. Si la traduccion
// mirase solo el texto, un nombre de zona que se llamase `area_not_found`
// podria convertirse en un 404.
//
// Lo que se comprueba, entonces:
//
//   - El par correcto produce el codigo correcto.
//   - El sentinel SIN su errcode no produce nada: un 23514 con el texto del
//     sentinel sigue siendo un 400 de formato, no un 404.
//   - El errcode SIN su sentinel no produce el error de negocio.
//   - Un 23505 desconocido sigue siendo un 409 (el indice del nombre puede
//     cambiar de nombre; la categoria de conflicto no).
//   - Un 42501 desconocido es un 403 y no un 500.
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
  it('mapea el par (P0002, area_not_found) a un 404', () => {
    const error = translate(errorDePostgres('P0002', 'area_not_found: no existe o no es visible'))

    expect(error).not.toBeNull()
    expect(error?.status).toBe(404)
    expect(error?.code).toBe('NOT_FOUND')
  })

  it('mapea el par (23505, area_name_taken) a un 409', () => {
    // El caso que motiva la regla del par en este bloque: el nombre duplicado
    // es un conflicto y no un 400, porque el dato del formulario es valido, lo
    // que pasa es que ya lo usa otro.
    const error = translate(errorDePostgres('23505', 'area_name_taken: ya existe una zona con ese nombre'))

    expect(error?.status).toBe(409)
    expect(error?.code).toBe('CONFLICT')
  })

  it('mapea los dos 22023 guardas a un 400', () => {
    for (const sentinel of ['area_name_required', 'area_date_required']) {
      const error = translate(errorDePostgres('22023', `${sentinel}: falta el campo`))

      expect(error?.status, `con ${sentinel}`).toBe(400)
    }
  })

  it('mapea (42501, forbidden_role) a un 403', () => {
    const error = translate(errorDePostgres('42501', 'forbidden_role: no es ADMIN de la comunidad'))

    expect(error?.status).toBe(403)
  })

  it('mapea la falta de contexto de usuario a un 401', () => {
    const error = translate(errorDePostgres('42501', 'sin contexto de usuario'))

    expect(error?.status).toBe(401)
  })

  // El caso que motiva todo este archivo.
  it('un sentinel SIN su errcode no se convierte en el error de negocio', () => {
    // 23514 con el texto del sentinel de nombre duplicado. Si la traduccion
    // mirase solo el mensaje, esto seria un 409 y el cliente ofreceria elegir
    // otro nombre cuando en realidad es un CHECK de longitud reventado.
    const error = translate(
      errorDePostgres('23514', 'area_name_taken: violates check constraint "common_areas_name_length"'),
    )

    expect(error?.status).toBe(400)
    expect(error?.code).toBe('VALIDATION_ERROR')
  })

  it('un sentinel con un errcode de otro tipo tampoco se mezcla con otro caso', () => {
    // El sentinel de "no encontrado" con un 23514 sigue siendo un 400 de
    // formato, no un 404.
    const con23514 = translate(errorDePostgres('23514', 'area_not_found: violates check constraint'))
    expect(con23514?.status).toBe(400)

    // Y con un 42501 NO es un 404: el par no coincide. Cae en el fallback
    // generico de 42501, que es un 403 — y es la respuesta honesta: 42501 es
    // siempre falta de privilegio, venga con el sentinel que venga. Lo que NO
    // puede pasar es que sea un 404.
    const con42501 = translate(errorDePostgres('42501', 'area_not_found: lo que sea'))
    expect(con42501?.status).toBe(403)
  })

  it('un 23505 sin sentinel conocido sigue siendo un 409', () => {
    // El indice del nombre por comunidad se llama hoy `common_areas_name_...`;
    // si un dia cambiara de nombre y el sentinel dejara de viajar, el 409 no
    // deberia degradarse a un 500 que nadie sabe mirar.
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

  it('un 22023 sin sentinel es un 400', () => {
    const error = translate(errorDePostgres('22023', 'invalid_parameter_value'))

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
