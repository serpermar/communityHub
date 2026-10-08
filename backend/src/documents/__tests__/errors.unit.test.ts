// ---------------------------------------------------------------------------
// Traduccion de los errores de PL/pgSQL a HTTP (documentos).
//
// Tests unitarios: la traduccion se decide por el PAR (errcode, sentinel), y
// la combinacion de las dos se puede fabricar aqui sin base de datos.
//
// La diferencia con avisos (AN-11) esta explicita en un test: ESTE modulo SI
// convierte `document_path_taken` (23505 con sentinel) en un 409 — existe el
// indice unico `documents_storage_path_uidx` y el alta lo capiturra como caso
// previsto. Pero un 23505 SIN el sentinel sigue devolviendo null (500): un
// uuid v4 no colisiona, y disfrazar ese bug de "ya existe ese documento"
// seria esconderlo.
// ---------------------------------------------------------------------------

import { Prisma } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { translate } from '../errors.js'

function errorDePostgres(errcode: string, message: string): unknown {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code: 'P2010',
    clientVersion: 'test',
    meta: { code: errcode, message },
  })
}

describe('translate', () => {
  it('mapea el par (P0002, document_not_found) a un 404', () => {
    const error = translate(errorDePostgres('P0002', 'document_not_found: no existe o no es visible'))

    expect(error).not.toBeNull()
    expect(error?.status).toBe(404)
    expect(error?.code).toBe('NOT_FOUND')
  })

  it('mapea (42501, forbidden_role) a un 403 generico de rol', () => {
    const error = translate(errorDePostgres('42501', 'forbidden_role: no es miembro de la comunidad'))

    expect(error?.status).toBe(403)
    expect(error?.code).toBe('FORBIDDEN')
  })

  it('mapea (42501, document_requires_admin) a un 403 de borrado', () => {
    const error = translate(errorDePostgres('42501', 'document_requires_admin: solo un ADMIN puede borrar'))

    expect(error?.status).toBe(403)
    expect(error?.message).toBe('Solo un administrador puede borrar documentos.')
  })

  it('mapea (U0001, document_path_taken) a un 409 CONFLICT', () => {
    // La novedad del bloque: esta ruta del bucket ya esta tomada por el indice
    // unico documents_storage_path_uidx. Es el unico 409 de la API. El par se
    // exige igualmente: un U0001 sin el sentinel no es el caso de negocio.
    const error = translate(errorDePostgres('U0001', 'document_path_taken: esa ruta ya esta ocupada en el bucket'))

    expect(error?.status).toBe(409)
    expect(error?.code).toBe('CONFLICT')
  })

  it('mapea (22023, document_content_required) a un 400', () => {
    const error = translate(errorDePostgres('22023', 'document_content_required: título y archivo obligatorios'))

    expect(error?.status).toBe(400)
  })

  it('mapea (22023, document_size_invalid) a un 400', () => {
    const error = translate(errorDePostgres('22023', 'document_size_invalid: el archivo debe pesar más de 0 bytes'))

    expect(error?.status).toBe(400)
  })

  it('mapea la falta de contexto de usuario a un 401', () => {
    const error = translate(errorDePostgres('42501', 'sin contexto de usuario'))

    expect(error?.status).toBe(401)
    expect(error?.code).toBe('UNAUTHORIZED')
  })

  it('un sentinel SIN su errcode no se convierte en el error de negocio', () => {
    // 23514 con el texto del sentinel de documento inexistente: si la
    // traduccion mirara solo el mensaje, seria un 404 cuando es un CHECK.
    const error = translate(errorDePostgres('23514', 'document_not_found: violates check constraint "documents_title_length"'))

    expect(error?.status).toBe(400)
    expect(error?.code).toBe('VALIDATION_ERROR')
  })

  it('un sentinel con un errcode de otro tipo no se mezcla con otro caso', () => {
    const con23514 = translate(errorDePostgres('23514', 'document_requires_admin: violates check constraint'))
    expect(con23514?.status).toBe(400)

    // document_path_taken con 22023 no es un 409: el par no coincide.
    const con22023 = translate(errorDePostgres('22023', 'document_path_taken: lo que sea'))
    expect(con22023?.status).toBe(400)

    // document_path_taken sin errcode de negocio tampoco.
    const sinU0001 = translate(errorDePostgres('23505', 'document_path_taken: lo que sea'))
    expect(sinU0001).toBeNull()
  })

  it('un 23505 SIN su sentinel NO se convierte en 409', () => {
    // El complemento de document_path_taken: la ruta colisiono, pero el
    // mensaje no lleva el sentinel. Eso no es un conflicto previsto — es un
    // bug del esquema (un uuid v4 no colisiona), y como los demas erricodes
    // desconocidos se deja pasar como 500.
    const error = translate(errorDePostgres('23505', 'duplicate key value violates unique constraint "documents_pkey"'))

    expect(error).toBeNull()
  })

  it('un 42501 sin sentinel conocido es un 403 y no un 500', () => {
    const error = translate(errorDePostgres('42501', 'new row violates row-level security policy'))

    expect(error?.status).toBe(403)
  })

  it('un 23514 sin sentinel es un 400', () => {
    const error = translate(errorDePostgres('23514', 'violates check constraint "documents_title_length"'))

    expect(error?.status).toBe(400)
  })

  it('un 22P02 es un 400, no un 500', () => {
    const error = translate(errorDePostgres('22P02', 'invalid input syntax for type document_category'))

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