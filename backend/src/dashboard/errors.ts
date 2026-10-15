// ---------------------------------------------------------------------------
// Del sentinel de PL/pgSQL al error HTTP (dashboard).
//
// `app_community_dashboard()` levanta dos casos con sentinel y `errcode`:
//
//   - `sin contexto de usuario` (42501) -> 401. Inalcanzable por la ruta, que
//     va con `requireAuth`, pero la funcion se puede llamar directo.
//   - `forbidden_role: ...` (42501) -> 403. El grueso lo hace `requireCommunity()`
//     en la ruta; esto es el backstop de la funcion (DSH-6).
//
// Se exige EL PAR (errcode + sentinel), como en finanzas (R-12): un sentinel es
// una cadena y cualquier titulo del cliente podria acabar dentro del mensaje de
// un error de Postgres. Con el par, un texto que se llamase `forbidden_role` no
// se convierte en un 403.
//
// El `community_not_found` (P0002) es defensivo; ver 02n.
// ---------------------------------------------------------------------------

import { Prisma } from '@prisma/client'
import { AppError, forbidden, notFound, unauthorized } from '../http/errors.js'

/** El `errcode` y el mensaje que PostgreSQL trae al cliente de Prisma. */
type Origen = { errcode: string; message: string }

/**
 * Saca el par (errcode, mensaje) de un fallo de `$queryRaw`. Un fallo de consulta
 * en crudo SIEMPRE llega como `P2010`, con el codigo de PostgreSQL en `meta.code`.
 */
function dePostgres(error: unknown): Origen | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null
  if (error.code !== 'P2010') return null

  const errcode = error.meta?.code
  const message = error.meta?.message

  if (typeof errcode !== 'string' || typeof message !== 'string') return null

  return { errcode, message }
}

/** Los casos de negocio del bloque, segun la tabla de la spec 13 §8. */
const NEGOCIO: ReadonlyArray<{ sentinel: string; errcode: string; error: () => AppError }> = [
  {
    sentinel: 'forbidden_role',
    errcode: '42501',
    error: () => forbidden('No perteneces a esta comunidad.'),
  },
  {
    sentinel: 'community_not_found',
    errcode: 'P0002',
    error: () => notFound('Esa comunidad no existe.'),
  },
  { sentinel: 'sin contexto de usuario', errcode: '42501', error: () => unauthorized() },
]

/**
 * Traduce un error de la base de datos al error de HTTP que le corresponde.
 * Devuelve `null` cuando el error no es un caso conocido: quien llama lo vuelve
 * a lanzar y el middleware de errores lo acaba devolviendo como 500.
 */
export function translate(error: unknown): AppError | null {
  const origen = dePostgres(error)

  if (!origen) return null

  for (const caso of NEGOCIO) {
    if (origen.errcode === caso.errcode && origen.message.includes(caso.sentinel)) {
      return caso.error()
    }
  }

  // Sin sentinel conocido, 42501 sigue siendo inequivoco: si una politica de RLS
  // se cerrara de mas, el sintoma es un 403 y no un 500.
  if (origen.errcode === '42501') return forbidden('No perteneces a esta comunidad.')

  return null
}

/**
 * Ejecuta una accion y traduce sus errores de base de datos. Un `AppError` que ya
 * es del dominio pasa intacto: `translate` devuelve `null` y lo relanza.
 */
export async function ejecuta<T>(accion: () => Promise<T>): Promise<T> {
  try {
    return await accion()
  } catch (error) {
    throw translate(error) ?? error
  }
}
