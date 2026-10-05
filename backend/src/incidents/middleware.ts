// ---------------------------------------------------------------------------
// Middleware de incidencias.
//
// Una sola pieza, `requireIncident()`, y existe por una razon concreta: las rutas de
// incidencia NO llevan `communityId` en la URL.
//
//   GET   /api/v1/incidents/:id
//   PUT   /api/v1/incidents/:id
//
// Eso es lo que dice ARCHITECTURE.md, y tiene sentido: una incidencia tiene ya su
// comunidad, y pedirla a la vez que la comunidad seria pedir dos veces lo mismo. El
// precio es que `requireCommunity()` no se puede usar en estas rutas, porque no hay
// `:communityId` de donde sacarlo, y `requireCommunityRole()` leeria `req.community`
// sin que nadie lo hubiera puesto.
//
// `requireIncident()` es el equivalente: resuelve la comunidad de la incidencia y la
// deja en `req.community`, con lo que el resto de la ruta (y el servicio) ya funcionan
// como en los otros modulos.
//
// Por que va en ESTE archivo y no en `auth/middleware.ts`: ese es del bloque 01 y la
// spec 03 declaro que no se toca. La convencion del proyecto es validar en el modulo
// (ver `members/validators.ts`, que redeclara el `uuidSchema` a proposito).
//
// Y por que NO lleva `requireCommunityRole`: el rol no se decide aqui. Lo consulta
// `app_role_in()` dentro de `app_incident_community`, contra la fila, y quien decide
// que es lo que se puede hacer con ese rol son las funciones de escritura. Una ruta
// con `requireCommunityRole('ADMIN')` aqui mentiría: no hay comunidad en el camino, y
// un guard que comprobaria el rol contra `req.community` sin haberlo escrito todavia
// daria un 401 a todo el mundo.
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express'
import { withContext } from '../context.js'
import { badRequest, forbidden, notFound, unauthorized } from '../http/errors.js'
import { routeParam } from '../auth/middleware.js'

/** Mismo criterio que `requireUuidParam` de `auth/middleware.ts` (C-9). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `app_incident_community()` devuelve la comunidad de la incidencia, o NULL si el
 * actor no puede verla.
 */
async function comunidadDe(incidentId: string, userId: string): Promise<string | null> {
  return withContext({ userId, communityId: null }, async (tx) => {
    const rows = await tx.$queryRaw<Array<{ community_id: string | null }>>`
      select app_incident_community(${incidentId}::uuid) as community_id
    `
    return rows[0]?.community_id ?? null
  })
}

/**
 * Exige una incidencia visible y deja su comunidad en `req.community`.
 *
 * Tres casos y tres respuestas distintas, y la diferencia importa:
 *
 *   - `:id` que no es un UUID: **400**. Es una peticion mal formada, no una peticion
 *     sin permiso. Comprobado antes de tocar la base de datos, porque un `::uuid`
 *     sobre texto invalido revienta con 22P02.
 *   - `:id` que no existe, o que existe pero no es visible para este actor: **404**.
 *     Los dos son el mismo 404 y por el mismo motivo (C-8): un 403 o un 410
 *     confirmarian que ese id existe. La funcion devuelve NULL en ambos casos y es
 *     aqui donde se traduce.
 *   - `:id` de una comunidad a la que ya no pertenece: tambien **404**, no 403. Es el
 *     mismo argumento: si el vecino ya no es miembro, su identificador de incidencia
 *     tampoco le dice nada, y un 403 le confirmaria que la incidencia sigue viva.
 *
 * El `communityId: null` en el `withContext` no es un descuido: es lo correcto, y es
 * necesario. La comunidad la DECIDE la consulta, no el contexto: si se fijara antes,
 * habria que saberla para poder descubrirla. `app_can_see_incident()` no usa
 * `app.current_community_id` para nada, solo `app_current_user_id()`, asi que el
 * contexto de comunidad no afecta al resultado.
 */
export function requireIncident(paramName = 'id') {
  return async function incidentGuard(req: Request, _res: Response, next: NextFunction): Promise<void> {
    if (!req.auth) {
      throw unauthorized()
    }

    const incidentId = routeParam(req, paramName)

    if (!UUID_RE.test(incidentId)) {
      throw badRequest(`El parámetro ${paramName} debe ser un UUID.`)
    }

    const communityId = await comunidadDe(incidentId, req.auth.userId)

    if (!communityId) {
      throw notFound('Esa incidencia no existe.')
    }

    // El rol se resuelve aqui con `app_role_in()` y no con el que lleva el token de
    // sesion, por el mismo motivo que en `requireCommunity`: el token dura 15 minutos,
    // asi que leer el rol de ahi permitiria seguir haciendo cosas de ADMIN durante la
    // ventana despues de haber sido degradado.
    const rows = await withContext({ userId: req.auth.userId, communityId }, (tx) =>
      tx.$queryRaw<Array<{ role: string | null }>>`
        select app_role_in(${communityId}::uuid) as role
      `,
    )

    const role = rows[0]?.role ?? null

    // No debería pasar: si `app_can_see_incident()` dice que se ve, hay membresía
    // activa. Si pasara, es un bug en el predicado, y un 403 es la respuesta honesta.
    if (!role) {
      throw forbidden('No perteneces a esta comunidad.')
    }

    req.community = { communityId, role }
    next()
  }
}