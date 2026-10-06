// ---------------------------------------------------------------------------
// Middleware de zonas comunes.
//
// Una sola pieza, `requireCommonArea()`, y existe por la misma razon que
// `requireIncident()`: dos de las cuatro rutas de zona NO llevan `communityId`
// en la URL:
//
//   PUT    /api/v1/common-areas/:id
//   GET    /api/v1/common-areas/:id/availability?date
//
// Eso es lo que dice ARCHITECTURE.md 6, y tiene sentido: la zona tiene ya su
// comunidad, y pedirla a la vez seria pedir dos veces lo mismo. El precio es que
// `requireCommunity()` no se puede usar (no hay `:communityId` de donde
// sacarlo), y este middleware es el equivalente: resuelve la comunidad de la
// zona con `app_common_area_community()` y la deja en `req.community`.
//
// Es ademas la respuesta a lo que la spec 04 11 dejo escrito como riesgo abierto
// para este bloque: una ruta de zona sin comunidad en el camino, cuyo `communityId`
// tendria que venir de alguna parte o no vendria. Viene de la propia fila.
//
// Por que NO lleva `requireCommunityRole`: el rol no se decide aqui. Lo consulta
// `app_role_in()` dentro de la misma funcion, contra la fila, y quien decide que
// se puede hacer con ese rol son `app_create_common_area()` y
// `app_update_common_area()`, dentro de la transaccion. Un guard en la ruta daria
// el mismo 403 con un mensaje peor, y si el guard se olvidara el endpoint
// seguiria seguro —pero al reves, si la comprobacion viviera solo en el guard,
// el mismo endpoint seria un agujero por PostgREST.
//
// Por que va en ESTE archivo y no en `auth/middleware.ts`: ese es del bloque 01
// y la spec 03 declaro que no se toca. La convencion del proyecto es validar en
// el modulo (ver `members/validators.ts`, que redeclara el `uuidSchema`).
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express'
import { withContext } from '../context.js'
import { badRequest, forbidden, notFound, unauthorized } from '../http/errors.js'
import { routeParam } from '../auth/middleware.js'

/** Mismo criterio que `requireUuidParam` de `auth/middleware.ts` (C-9). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `app_common_area_community()` devuelve la comunidad de la zona, o NULL si el
 * actor no puede verla.
 */
async function comunidadDe(areaId: string, userId: string): Promise<string | null> {
  return withContext({ userId, communityId: null }, async (tx) => {
    const rows = await tx.$queryRaw<Array<{ community_id: string | null }>>`
      select app_common_area_community(${areaId}::uuid) as community_id
    `
    return rows[0]?.community_id ?? null
  })
}

/**
 * Exige una zona visible y deja su comunidad en `req.community`.
 *
 * Tres casos y tres respuestas, y la diferencia importa:
 *
 *   - `:id` que no es un UUID: **400**. Peticion mal formada, no peticion sin
 *     permiso. Comprobado antes de tocar la base de datos, porque un `::uuid`
 *     sobre texto invalido revienta con 22P02.
 *   - `:id` que no existe, o que existe pero no es visible para este actor:
 *     **404**. Los dos son el mismo 404 y por el mismo motivo (C-8): un 403
 *     confirmaria que ese id existe. La funcion devuelve NULL en ambos casos y
 *     es aqui donde se traduce.
 *   - `:id` de una comunidad a la que ya no pertenece: tambien **404**, no 403.
 *     Mismo argumento: si el vecino ya no es miembro, el identificador de la
 *     zona tampoco le dice nada.
 *
 * El `communityId: null` del `withContext` no es un descuido: la comunidad la
 * DECIDE la consulta, no el contexto. Si se fijara antes habria que saberla para
 * poder descubrirla, que es lo contrario del problema que resuelve este guard.
 */
export function requireCommonArea(paramName = 'id') {
  return async function commonAreaGuard(req: Request, _res: Response, next: NextFunction): Promise<void> {
    if (!req.auth) {
      throw unauthorized()
    }

    const areaId = routeParam(req, paramName)

    if (!UUID_RE.test(areaId)) {
      throw badRequest(`El parámetro ${paramName} debe ser un UUID.`)
    }

    const communityId = await comunidadDe(areaId, req.auth.userId)

    if (!communityId) {
      throw notFound('Esa zona común no existe.')
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

    // No deberia pasar: si `app_common_area_community()` dice que se ve, hay
    // membresia activa. Si pasara, es un bug en el predicado, y un 403 es la
    // respuesta honesta.
    if (!role) {
      throw forbidden('No perteneces a esta comunidad.')
    }

    req.community = { communityId, role }
    next()
  }
}
