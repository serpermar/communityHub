// ---------------------------------------------------------------------------
// Rutas de avisos.
//
// Se montan en DOS routers porque las cuatro rutas no comparten el mismo
// prefijo: las dos de comunidad cuelgan de `/api/v1/communities` y las otras
// dos de `/api/v1`. Los montajes en `app.ts` son dos `app.use` distintos, y el
// orden no importa porque cada router solo atiende las suyas.
//
// Y las rutas se escriben COMPLETAS dentro de cada router, en vez de montar un
// router en un camino con parametros, que es lo que ya hacen los bloques 01-06:
// deja claro que las rutas de comunidad cuelgan del mismo sitio que las de
// `/communities/:communityId`.
//
// El orden de los middleware ES la autorizacion:
//
//   GET    /communities/:communityId/announcements   requireAuth + requireCommunity()
//   POST   /communities/:communityId/announcements   + requireCommunityRole('PRESIDENT','ADMIN')
//   PUT    /announcements/:id                        requireAuth + requireAnnouncement()
//   DELETE /announcements/:id                        requireAuth + requireAnnouncement()
//
// TRES cosas que se ven aqui y que son decisiones, no descuido:
//
//   1. `requireAnnouncement()` va DESPUES de `requireAuth`, siempre. Necesita
//      `req.auth`. Al reves, el 401 seria un TypeError.
//
//   2. `requireAnnouncement()` NO lleva `requireCommunityRole`. El rol lo
//      consulta `app_role_in()` dentro de la transaccion, contra la fila, y
//      quien decide que se puede hacer con ese rol son
//      `app_update_announcement()` y `app_delete_announcement()`. Un guard
//      aqui daria el mismo 403 con un mensaje peor, y si el guard se olvidara
//      el endpoint seguira seguro —pero al reves, si la comprobacion viviera
//      solo en el guard, el mismo endpoint seria un agujero por PostgREST, que
//      no pasa por Express.
//
//   3. El POST si lleva `requireCommunityRole('PRESIDENT', 'ADMIN')` como
//      chequeo grueso (AN-1), igual que el POST de incidencias y el de zonas
//      comunes. La funcion lo repite dentro: un rol insuficiente falla antes de
//      abrir transaccion, con un 403 que lo dice, y el endpoint sigue siendo
//      seguro aunque el guard desaparezca.
//
// El DELETE no lleva `requireCommunityRole('ADMIN')` ni siquiera como chequeo
// grueso, y no es una excepcion caprichosa: es AN-1. El borrado es de ADMIN
// UNICO y el unico que lo dice es `app_delete_announcement()` con
// `announcement_requires_admin`, porque es donde esta la fila y el rol real.
// ---------------------------------------------------------------------------

import { Router } from 'express'
import * as controller from './controller.js'
import { requireAuth, requireCommunity, requireCommunityRole } from '../auth/middleware.js'
import { requireAnnouncement } from './middleware.js'

/**
 * Rutas con la comunidad en la URL.
 *
 * El listado NO lleva `requireCommunityRole`: leer avisos es de cualquier
 * miembro activo (la matriz de ARCHITECTURE.md §5), y la ventana por rol la
 * decide `app_list_announcements()`.
 *
 * El alta si lo lleva, con los dos roles que permiten liderazgo (AN-1).
 */
export function createAnnouncementsRouter(): Router {
  const router = Router()

  router.get('/:communityId/announcements', requireAuth, requireCommunity(), controller.listAnnouncements)

  router.post(
    '/:communityId/announcements',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('PRESIDENT', 'ADMIN'),
    controller.createAnnouncement,
  )

  return router
}

/**
 * Rutas con el aviso en la URL.
 *
 * `requireAnnouncement()` sustituye a `requireCommunity()` en las dos: resuelve
 * la comunidad del aviso con `app_announcement_community()` y la deja en
 * `req.community`, con lo que el servicio funcionaria igual que en el resto del
 * proyecto. Es la pieza que la spec 04 §11 dejo anotada como riesgo abierto
 * para los modulos con id y no comunidad en la URL.
 *
 * Ninguna de las dos lleva `requireCommunityRole`, ni siquiera el PUT: el rol
 * lo decide la funcion con la fila delante, por el argumento 2 de la cabecera.
 */
export function createAnnouncementRouter(): Router {
  const router = Router()

  router.put('/announcements/:id', requireAuth, requireAnnouncement(), controller.updateAnnouncement)
  router.delete('/announcements/:id', requireAuth, requireAnnouncement(), controller.deleteAnnouncement)

  return router
}
