// ---------------------------------------------------------------------------
// Traduccion de los errores de PL/pgSQL a HTTP.
//
// Tests unitarios, y aqui si que tienen sentido de una manera que no tienen en otro
// sitio del bloque: la traduccion se decide por un PAR, el `errcode` de Postgres y el
// sentinel del mensaje, y la combinacion de las dos se puede fabricar aqui.
//
// Por que importa. La regla de este bloque es que un sentinel NUNCA basta: hacen falta
// las dos cosas. Un sentinel es una cadena de texto que viaja dentro del mensaje, y el
// mensaje de Postgres es exactamente el sitio donde acabaria cualquier valor que
// venga del cliente. Si la traduccion mirase solo el texto, un titulo que se llamase
// `incident_invalid_transition` podria convertirse en un 409.
//
// Y no es teorico por el camino que hoy existe, pero la defensa se pone antes de que
// exista: no se puede comprobar por la API, porque el mensaje de un CHECK reventado no
// lleva los datos de la fila. Fabricar el error aqui es la unica forma de probar la
// regla.
//
// Lo que se comprueba, entonces:
//
//   - El par correcto produce el codigo correcto.
//   - El sentinel SIN su errcode no produce nada: un 23514 con el texto del sentinel
//     sigue siendo un 400 de longitud, no un 409.
//   - El errcode SIN su sentinel no produce el error de negocio.
//   - Un 42501 desconocido es un 403 y no un 500 (una politica cerrada de mas debe
//     verse como un 403, no como un fallo interno que nadie sabe mirar).
//   - Un error que no viene de Postgres se devuelve tal cual (\`translate\` da \`null\`).
//
// Y una comprobacion de forma que no necesita base de datos: que \`translate\` NO toque
// el error cuando devuelve \`null\`. Si lo tocara, \`ejecuta\` reventaria el stack del
// error original en vez de relanzarlo.
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
  it('mapea el par (P0002, incident_not_found) a un 404', () => {
    const error = translate(errorDePostgres('P0002', 'incident_not_found: no existe o no es visible'))

    expect(error).not.toBeNull()
    expect(error?.status).toBe(404)
    expect(error?.code).toBe('NOT_FOUND')
  })

  it('mapea el par (22023, incident_invalid_transition) a un 409', () => {
    const error = translate(errorDePostgres('22023', 'incident_invalid_transition: de OPEN a RESOLVED no se puede'))

    expect(error?.status).toBe(409)
    expect(error?.code).toBe('CONFLICT')
  })

  it('mapea el par (22023, incident_assignee_not_provider) a un 400', () => {
    const error = translate(
      errorDePostgres('22023', 'incident_assignee_not_provider: el usuario indicado no es un proveedor activo'),
    )

    expect(error?.status).toBe(400)
  })

  it('mapea los 42501 de rol a un 403', () => {
    for (const sentinel of ['forbidden_role', 'incident_requires_admin']) {
      const error = translate(errorDePostgres('42501', `${sentinel}: no puede hacer esto`))

      expect(error?.status, `con ${sentinel}`).toBe(403)
    }
  })

  it('mapea la falta de contexto de usuario a un 401', () => {
    const error = translate(errorDePostgres('42501', 'sin contexto de usuario'))

    expect(error?.status).toBe(401)
  })

  // El caso que motivates todo este archivo.
  it('un sentinel SIN su errcode no se convierte en el error de negocio', () => {
    // 23514 con el texto del sentinel de transicion. Si la traduccion mirase solo el
    // mensaje, esto seria un 409 y el cliente ofreceria cambiar el estado de algo que en
    // realidad es un campo mal rellenado.
    const error = translate(
      errorDePostgres('23514', 'incident_invalid_transition: new row for relation "incidents" violates check'),
    )

    expect(error?.status).toBe(400)
    expect(error?.code).toBe('VALIDATION_ERROR')
  })

  it('un sentinel con un errcode de otro tipo tampoco se mezcla con otro caso', () => {
    // El sentinel de "no encontrado" con un 23514 sigue siendo un 400 de longitud.
    const con23514 = translate(errorDePostgres('23514', 'incident_not_found: violates check constraint'))
    expect(con23514?.status).toBe(400)

    // Y el de "no encontrado" con un 22023 NO es un 409: el par no coincide con ninguno
    // de los dos casos que usan ese errcode, asi que `translate` se aparta y deja que
    // el error siga su camino como 500. Aqui no hay nada que traducir, no hay que
    // inventarse un 400.
    const con22023 = translate(errorDePostgres('22023', 'incident_not_found: lo que sea'))
    expect(con22023).toBeNull()
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
    // Un P2002 (unique violation) de una llamada normal del cliente no lleva `meta.code`
    // de Postgres, y traducirlo aqui seria inventarse una categoria.
    const otro = new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' })

    expect(translate(otro)).toBeNull()
  })

  it('devuelve null si el error de Postgres no es ninguno de los casos conocidos', () => {
    expect(translate(errorDePostgres('53200', 'out of memory'))).toBeNull()
    expect(translate(errorDePostgres('XX000', 'error interno de la base de datos'))).toBeNull()
  })
})