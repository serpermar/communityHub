// ---------------------------------------------------------------------------
// Del sentinel de PL/pgSQL al error HTTP (documentos).
//
// Las funciones de 02i_documents.sql levantan los casos de negocio con un
// sentinel al principio del mensaje y un `errcode` de Postgres. Este archivo
// es el unico sitio que sabe traducirlos, y el unico que decide que un 42501
// es un 403 y no un 500.
//
// Se exige EL PAR de las dos cosas y no solo el sentinel (R-12): un sentinel
// es una cadena de texto, y cualquier titulo o descripcion del cliente puede
// acabar dentro del mensaje de un error de Postgres. Con el par, un cuerpo
// que se llamase `document_not_found` no puede convertirse en un 404.
//
// SI hay 409 en este modulo, y con intencion: es `document_path_taken`.
// Al contrario que avisos (AN-11), `documents` tiene un indice unico
// real —`documents_storage_path_uidx`— que es la clave del sistema, y una
// colision de ruta es un caso que el alta captura y re-lanza con sentinel.
//
// El SQLSTATE es U0001 y no 23505 a propósito: Prisma (P2010) traduce cualquier
// 23505 que reciba a "Unique constraint failed: ..." y descarta su mensaje, así
// que el sentinel de un 23505 real jamás llegaría a este módulo. U0001 es una
// clase propia sin significado estándar, así que el mensaje sí viaja entero. Y
// el 23505 sin U0001 sigue sin convertirse en 409: si la función lo deja pasar
// es un bug del esquema (un uuid v4 no colisiona), y disfrazarlo de
// comportamiento previsto lo esconderia.
// ---------------------------------------------------------------------------

import { Prisma } from '@prisma/client'
import { AppError, badRequest, conflict, forbidden, notFound, unauthorized } from '../http/errors.js'

/** El `errcode` y el mensaje que PostgreSQL trae al cliente de Prisma. */
type Origen = { errcode: string; message: string }

/**
 * Saca el par (errcode, mensaje) de un fallo de `$queryRaw` / `$executeRaw`.
 * Un fallo de consulta en crudo SIEMPRE llega como `P2010`, con el codigo de
 * PostgreSQL en `meta.code` y no en `message`.
 */
function dePostgres(error: unknown): Origen | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null
  if (error.code !== 'P2010') return null

  const errcode = error.meta?.code
  const message = error.meta?.message

  if (typeof errcode !== 'string' || typeof message !== 'string') return null

  return { errcode, message }
}

/** Los casos de negocio de este bloque. El orden no importa: los sentinel son distintos entre si. */
const NEGOCIO: ReadonlyArray<{ sentinel: string; errcode: string; error: () => AppError }> = [
  {
    // No existe, no es visible para este actor, esta borrado o es de otra
    // comunidad. Las cuatro son el mismo 404 y por el mismo motivo (C-8): un
    // 403 confirmaria que ese id existe (tabla §7.4 de la spec).
    sentinel: 'document_not_found',
    errcode: 'P0002',
    error: () => notFound('Ese documento no existe o no es visible.'),
  },
  {
    // El alta por un rol que no da para gestionar documentos (DN-1).
    sentinel: 'forbidden_role',
    errcode: '42501',
    error: () => forbidden('Tu rol en esta comunidad no permite esta acción.'),
  },
  {
    // El borrado por un PRESIDENT: destruir el historico es exclusivo de ADMIN
    // (DN-1/DN-11). Mensaje propio, igual que en avisos (AN-5).
    sentinel: 'document_requires_admin',
    errcode: '42501',
    error: () => forbidden('Solo un administrador puede borrar documentos.'),
  },
  {
    // La ruta del bucket ya esta tomada: `documents_storage_path_uidx`.
    // En la practica inalcanzable (el path lo genera el backend con uuid v4);
    // el sentinel existe para que una colision no salga como 500. El SQLSTATE
    // es el propio U0001, no 23505: ver la cabecera de este archivo.
    sentinel: 'document_path_taken',
    errcode: 'U0001',
    error: () => conflict('CONFLICT', 'Ya existe un documento con esa ruta en el bucket.'),
  },
  {
    // Guarda interna del alta, inalcanzable desde la API (zod exige titulo y
    // el archivo existe). Esta igualmente para una llamada directa a la funcion.
    sentinel: 'document_content_required',
    errcode: '22023',
    error: () => badRequest('El título y el archivo son obligatorios.'),
  },
  {
    // Guarda interna del alta (red para el CHECK documents_size_positive).
    sentinel: 'document_size_invalid',
    errcode: '22023',
    error: () => badRequest('El archivo debe pesar más de 0 bytes.'),
  },
  { sentinel: 'sin contexto de usuario', errcode: '42501', error: () => unauthorized() },
]

/**
 * Traduce un error de la base de datos al error de HTTP que le corresponde.
 * Devuelve `null` cuando el error no viene de PostgreSQL o no es un caso
 * conocido: quien llama lo vuelve a lanzar tal cual y el middleware de errores
 * lo acaba devolviendo como 500.
 */
export function translate(error: unknown): AppError | null {
  const origen = dePostgres(error)

  if (!origen) return null

  for (const caso of NEGOCIO) {
    if (origen.errcode === caso.errcode && origen.message.includes(caso.sentinel)) {
      return caso.error()
    }
  }

  // Sin sentinel, un 23505 NO se convierte en 409: ver la cabecera de este
  // archivo. Un `document_path_taken` siempre viaja con su sentinel.

  // CHECK de longitud reventado en la tabla: 23514 sin sentinel -> 400. El
  // caso normal lo intercepta zod en la entrada; este es el plan B de seguridad.
  if (origen.errcode === '23514') {
    return badRequest('Uno de los campos no cumple el formato permitido.')
  }

  // Enum, uuid o jsonb invalido: zod los valida antes, pero si llegaran...
  if (origen.errcode === '22P02') return badRequest('Uno de los valores enviados no es válido.')

  // 22023 sin sentinel: los que estas funciones saben levantar son problemas de
  // datos de entrada, asi que un 400 es la respuesta honesta.
  if (origen.errcode === '22023') return badRequest('Uno de los valores enviados no es válido.')

  // Sin sentinel conocido, 42501 sigue siendo inequivoco: si una politica de
  // RLS se cerrara de mas, el sintoma es un 403 y no un 500.
  if (origen.errcode === '42501') return forbidden()

  return null
}

/**
 * Ejecuta una accion y traduce sus errores de base de datos. Un `AppError` que
 * ya es del dominio pasa intacto: `translate` devuelve `null` y lo relanza.
 */
export async function ejecuta<T>(accion: () => Promise<T>): Promise<T> {
  try {
    return await accion()
  } catch (error) {
    throw translate(error) ?? error
  }
}