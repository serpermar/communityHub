// ---------------------------------------------------------------------------
// Middleware de avisos.
//
// Una sola pieza, `requireAnnouncement()`, y existe por la misma razon que
// `requireIncident()` y `requireCommonArea()`: las dos rutas de aviso por id NO
// llevan `communityId` en la URL:
//
//   PUT    /api/v1/announcements/:id
//   DELETE /api/v1/announcements/:id
//
// Eso es lo que dice ARCHITECTURE.md §6, y el motivo es el mismo que alli: el
// aviso tiene ya su comunidad, y pedirla a la vez seria pedir dos veces lo
// mismo. El precio es que `requireCommunity()` no se puede usar (no hay
// `:communityId` de donde sacarlo), y este middleware es el equivalente: resuelve
// la comunidad del aviso con `app_announcement_community()` y la deja en
// `req.community`.
//
// Por que NO lleva `requireCommunityRole`: el rol no se decide aqui. Lo consulta
// `app_role_in()` dentro de la misma funcion, contra la fila, y quien decide que
// se puede hacer con ese rol son `app_update_announcement()` y
// `app_delete_announcement()`, dentro de la transaccion. Un guard en la ruta
// daria el mismo 403 con un mensaje peor, y si el guard se olvidara el endpoint
// seguiria seguro —pero al reves, si la comprobacion viviera solo en el guard,
// el mismo endpoint seria un agujero por PostgREST.
//
// Por que va en ESTE archivo y no en `auth/middleware.ts`: ese es del bloque 01
// y la spec 03 declaro que no se toca. La convencion del proyecto es validar en
// el modulo (ver `common-areas/middleware.ts`, que es de donde sale este).
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express'
import { withContext } from '../context.js'
import { badRequest, forbidden, notFound, unauthorized } from '../http/errors.js'
import { routeParam } from '../auth/middleware.js'

/** Mismo criterio que `requireUuidParam` de `auth/middleware.ts` (C-9). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `app_announcement_community()` devuelve la comunidad del aviso, o NULL si el
 * actor no puede verlo.
 */
async function comunidadDe(announcementId: string, userId: string): Promise<string | null> {
  return withContext({ userId, communityId: null }, async (tx) => {
    const rows = await tx.$queryRaw<Array<{ community_id: string | null }>>`
      select app_announcement_community(${announcementId}::uuid) as community_id
    `
    return rows[0]?.community_id ?? null
  })
}

/**
 * Exige un aviso visible y deja su comunidad en `req.community`.
 *
 * Tres casos y tres respuestas, y la diferencia importa:
 *
 *   - `:id` que no es un UUID: **400**. Peticion mal formada, no peticion sin
 *     permiso. Comprobado antes de tocar la base de datos, porque un `::uuid`
 *     sobre texto invalido revienta con 22P02.
 *   - `:id` que no existe, o que existe pero no es visible para este actor
 *     (borrado, o de una comunidad a la que no pertenece): **404**. Los dos son
 *     el mismo 404 y por el mismo motivo (C-8): un 403 confirmaria que ese id
 *     existe. La funcion devuelve NULL en ambos casos y es aqui donde se
 *     traduce.
 *   - `:id` de un miembro SUSPENDIDO: tambien **404**, porque
 *     `app_announcement_community()` exige membresia activa.
 *
 * Y lo que NO comprueba la funcion es la ventana de AN-4 (programado/caducado):
 * gestionar es exactamente lo que hay que hacer con esos, y filtrarlos aqui
 * haria que un aviso programado fuera invisible para su propio PUT.
 *
 * El `communityId: null` del `withContext` no es un descuido: la comunidad la
 * DECIDE la consulta, no el contexto.
 */
export function requireAnnouncement(paramName = 'id') {
  return async function announcementGuard(req: Request, _res: Response, next: NextFunction): Promise<void> {
    if (!req.auth) {
      throw unauthorized()
    }

    const announcementId = routeParam(req, paramName)

    if (!UUID_RE.test(announcementId)) {
      throw badRequest(`El parámetro ${paramName} debe ser un UUID.`)
    }

    const communityId = await comunidadDe(announcementId, req.auth.userId)

    if (!communityId) {
      throw notFound('Ese aviso no existe.')
    }

    // El rol se resuelve aqui con `app_role_in()` y no con el del token de
    // sesion, por el mismo motivo que en `requireCommunity`: el token dura 15
    // minutos, y leer el rol de ahi permitiria seguir siendo ADMIN durante la
    // ventana despues de haber sido degradado.
    const rows = await withContext({ userId: req.auth.userId, communityId }, (tx) =>
      tx.$queryRaw<Array<{ role: string | null }>>`
        select app_role_in(${communityId}::uuid) as role
      `,
    )

    const role = rows[0]?.role ?? null

    // No deberia pasar: si `app_announcement_community()` dice que se ve, hay
    // membresia activa. Si pasara, es un bug en el predicado, y un 403 es la
    // respuesta honesta.
    if (!role) {
      throw forbidden('No perteneces a esta comunidad.')
    }

    req.community = { communityId, role }
    next()
  }
}
