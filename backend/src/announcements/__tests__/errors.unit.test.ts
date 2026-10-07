// ---------------------------------------------------------------------------
// Traduccion de los errores de PL/pgSQL a HTTP (avisos).
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
// mirase solo el texto, un cuerpo que se llamase `announcement_not_found`
// podria convertirse en un 404.
//
// Lo que se comprueba, entonces:
//
//   - El par correcto produce el codigo correcto, y los dos pares de 42501 se
//     distinguen entre si: `forbidden_role` es "tu rol no llega" y
//     `announcement_requires_admin` es "borrar es solo de admin" (AN-1).
//   - El sentinel SIN su errcode no produce nada: un 23514 con el texto del
//     sentinel sigue siendo un 400 de formato, no un 404.
//   - El errcode SIN su sentinel no produce el error de negocio.
//   - Un 23505 NO se convierte en 409 (AN-11): este modulo no tiene ningun
//     indice unico que el cliente pueda reventar, y disfrazar un 23505 de
//     conflicto previsto escondria un bug del esquema.
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
  it('mapea el par (P0002, announcement_not_found) a un 404', () => {
    const error = translate(errorDePostgres('P0002', 'announcement_not_found: no existe o no es visible'))

    expect(error).not.toBeNull()
    expect(error?.status).toBe(404)
    expect(error?.code).toBe('NOT_FOUND')
  })

  it('mapea (42501, forbidden_role) a un 403 generico de rol', () => {
    // El POST o el PUT por un NEIGHBOR o un PROVIDER.
    const error = translate(errorDePostgres('42501', 'forbidden_role: su rol no puede gestionar avisos'))

    expect(error?.status).toBe(403)
    expect(error?.code).toBe('FORBIDDEN')
  })

  it('mapea (42501, announcement_requires_admin) a un 403 con mensaje de borrado', () => {
    // El caso de AN-1: el PRESIDENT puede fijar y editar, pero no borrar. Los
    // dos pares llevan 42501 y por eso solo se distinguen por el sentinel.
    const error = translate(errorDePostgres('42501', 'announcement_requires_admin: solo un ADMIN puede borrar'))

    expect(error?.status).toBe(403)
    expect(error?.message).toBe('Solo un administrador puede borrar avisos.')
  })

  it('mapea (22023, announcement_content_required) a un 400', () => {
    // Guarda interna de `app_create_announcement()`, inalcanzable desde la API.
    const error = translate(errorDePostgres('22023', 'announcement_content_required: título y cuerpo obligatorios'))

    expect(error?.status).toBe(400)
  })

  it('mapea la falta de contexto de usuario a un 401', () => {
    const error = translate(errorDePostgres('42501', 'sin contexto de usuario'))

    expect(error?.status).toBe(401)
  })

  // El caso que motiva todo este archivo.
  it('un sentinel SIN su errcode no se convierte en el error de negocio', () => {
    // 23514 con el texto del sentinel de aviso inexistente. Si la traduccion
    // mirase solo el mensaje, esto seria un 404 cuando en realidad es un CHECK
    // de longitud reventado.
    const error = translate(
      errorDePostgres('23514', 'announcement_not_found: violates check constraint "announcements_title_length"'),
    )

    expect(error?.status).toBe(400)
    expect(error?.code).toBe('VALIDATION_ERROR')
  })

  it('un sentinel con un errcode de otro tipo tampoco se mezcla con otro caso', () => {
    // El sentinel de "requiere admin" con un 23514 sigue siendo un 400 de
    // formato, no un 403.
    const con23514 = translate(errorDePostgres('23514', 'announcement_requires_admin: violates check constraint'))
    expect(con23514?.status).toBe(400)

    // Y con un P0002 NO es un 403: el par no coincide. Un P0002 sin su
    // sentinel no esta en la tabla ni cae en ningun fallback, asi que es un
    // error desconocido y `translate` devuelve null (500).
    const conP0002 = translate(errorDePostgres('P0002', 'announcement_requires_admin: lo que sea'))
    expect(conP0002).toBeNull()
  })

  it('un 23505 NO se convierte en 409 (AN-11)', () => {
    // `announcements` no tiene ningun indice unico mas alla de la clave
    // primaria, asi que un 23505 solo puede venir de un bug del esquema. Un
    // 409 lo disfrazaria de comportamiento previsto ("ya existe ese aviso"),
    // cuando en realidad no hay nada que el cliente pueda corregir.
    const error = translate(errorDePostgres('23505', 'duplicate key value violates unique constraint'))

    expect(error).toBeNull()
  })

  it('un 42501 sin sentinel conocido es un 403 y no un 500', () => {
    const error = translate(errorDePostgres('42501', 'new row violates row-level security policy'))

    expect(error?.status).toBe(403)
  })

  it('un 23514 sin sentinel es un 400', () => {
    const error = translate(errorDePostgres('23514', 'violates check constraint "announcements_body_length"'))

    expect(error?.status).toBe(400)
  })

  it('un 22P02 es un 400, no un 500', () => {
    const error = translate(errorDePostgres('22P02', 'invalid input syntax for type announcement_type'))

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
