// ---------------------------------------------------------------------------
// Rutas de zonas comunes.
//
// Se montan en DOS routers porque las cuatro rutas no comparten el mismo
// prefijo: las dos de comunidad cuelgan de `/api/v1/communities` y las otras
// dos de `/api/v1`. Los montajes en `app.ts` son dos `app.use` distintos, y el
// orden no importa porque cada router solo atiende las suyas.
//
// Y las rutas se escriben COMPLETAS dentro de cada router, en vez de montar un
// router en un camino con parametros, que es lo que ya hacen los bloques 01-04:
// deja claro que las rutas de comunidad cuelgan del mismo sitio que las de
// `/communities/:communityId`.
//
// El orden de los middleware ES la autorizacion:
//
//   GET  /communities/:communityId/common-areas   requireAuth + requireCommunity()
//   POST /communities/:communityId/common-areas   + requireCommunityRole('ADMIN')
//   PUT  /common-areas/:id                        requireAuth + requireCommonArea()
//   GET  /common-areas/:id/availability           requireAuth + requireCommonArea()
//
// TRES cosas que se ven aqui y que son decisiones, no descuido:
//
//   1. `requireCommonArea()` va DESPUES de `requireAuth`, siempre. Necesita
//      `req.auth`. Al reves, el 401 seria un TypeError.
//
//   2. `requireCommonArea()` NO lleva `requireCommunityRole`. El rol lo
//      consulta `app_role_in()` dentro de `app_common_area_community`, contra
//      la fila, y quien decide que se puede hacer con ese rol son
//      `app_create_common_area()` y `app_update_common_area()`, dentro de la
//      transaccion. Un guard aqui daria el mismo 403 con un mensaje peor, y si
//      el guard se olvidara el endpoint seguiria seguro —pero al reves, si la
//      comprobacion viviera solo en el guard, el mismo endpoint seria un
//      agujero por PostgREST, que no pasa por Express.
//
//   3. El POST si lleva `requireCommunityRole('ADMIN')` como chequeo grueso,
//      igual que el POST de incidencias. La funcion lo repite dentro: un
//      rol insuficiente falla antes de abrir transaccion, con un 403 que lo
//      dice, y el endpoint sigue siendo seguro aunque el guard desaparezca.
// ---------------------------------------------------------------------------

import { Router } from 'express'
import * as controller from './controller.js'
import { requireAuth, requireCommunity, requireCommunityRole } from '../auth/middleware.js'
import { requireCommonArea } from './middleware.js'

/**
 * Rutas con la comunidad en la URL.
 *
 * El listado NO lleva `requireCommunityRole`: CA-1 dice que lee cualquier
 * miembro activo, y el alcance lo decide `app_list_common_areas()`.
 *
 * El alta si lo lleva, y solo `ADMIN`: "Gestionar zonas comunes" es de ADMIN
 * unico en la matriz de ARCHITECTURE.md §5.
 */
export function createCommonAreasRouter(): Router {
  const router = Router()

  router.get('/:communityId/common-areas', requireAuth, requireCommunity(), controller.listCommonAreas)

  router.post(
    '/:communityId/common-areas',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('ADMIN'),
    controller.createCommonArea,
  )

  return router
}

/**
 * Rutas con la zona en la URL.
 *
 * `requireCommonArea()` sustituye a `requireCommunity()` en las dos: resuelve
 * la comunidad de la zona y la deja en `req.community`, con lo que el servicio
 * y cualquier guard de rol posterior funcionarian igual que en el resto del
 * proyecto. Es la pieza que la spec 04 §11 dejo anotada como riesgo abierto
 * para este bloque.
 *
 * Ninguna de las dos lleva `requireCommunityRole('ADMIN')`, ni siquiera el PUT:
 * el rol lo decide `app_update_common_area()` con la fila delante, por el
 * argumento 2 de la cabecera.
 */
export function createCommonAreaRouter(): Router {
  const router = Router()

  router.put('/common-areas/:id', requireAuth, requireCommonArea(), controller.updateCommonArea)
  router.get('/common-areas/:id/availability', requireAuth, requireCommonArea(), controller.getAvailability)

  return router
}
