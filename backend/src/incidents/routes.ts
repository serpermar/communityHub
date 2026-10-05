// ---------------------------------------------------------------------------
// Rutas de incidencias.
//
// Se montan en DOS routers porque las ocho rutas no comparten el mismo prefijo:
// las dos de comunidad cuelgan de `/api/v1/communities` y las otras seis de
// `/api/v1`. Los montajes en `app.ts` son dos `app.use` distintos, y el orden no
// importa porque cada router solo atiende las suyas.
//
// Y las rutas se escriben COMPLETAS dentro de cada router, en vez de montar un router
// en un camino con parametros (`app.use('/incidents/:id', ...)`), que es lo que ya
// hacen el bloque 02 y el 03: deja claro que las rutas de comunidad cuelgan del mismo
// sitio que las de `/communities/:communityId`.
//
// El orden de los middleware ES la autorizacion:
//
//   GET    /communities/:communityId/incidents   requireAuth + requireCommunity()
//   POST   /communities/:communityId/incidents   + requireCommunityRole(NEIGHBOR, PRESIDENT, ADMIN)
//   GET    /incidents/:id                        requireAuth + requireIncident()
//   PUT    /incidents/:id                        requireAuth + requireIncident()
//   PATCH  /incidents/:id/status                 requireAuth + requireIncident()
//   DELETE /incidents/:id                        requireAuth + requireIncident()
//   GET    /incidents/:id/comments               requireAuth + requireIncident()
//   POST   /incidents/:id/comments               requireAuth + requireIncident()
//
// TRES cosas que se ven aqui y que son decisiones, no descuido:
//
//   1. `requireIncident()` va DESPUES de `requireAuth`, siempre. Necesita `req.auth`.
//      Al reves, el 401 seria un TypeError.
//
//   2. `requireIncident()` NO lleva `requireCommunityRole`. El rol lo consulta
//      `app_role_in()` dentro de `app_incident_community`, contra la fila. Un
//      `requireCommunityRole('ADMIN')` aqui leeria `req.community.role`— que el propio
//      `requireIncident` escribe, asi que funcionaria— pero solo en las rutas que lo
//      necesitan, y esas tres (PUT con prioridad, DELETE, y el estado) tienen reglas
//      que no son "ser ADMIN de la comunidad": el DELETE es de ADMIN, si, pero la
//      transicion es de ADMIN O del proveedor ASIGNADO, y un guard que admita solo
//      ADMIN le negaria al proveedor su unica operacion. La decision de quien puede
//      cambiar un estado la toma la funcion de SQL, con la fila delante.
//
//   3. El POST lleva `requireCommunityRole('NEIGHBOR', 'PRESIDENT', 'ADMIN')` y NO
//      `requireCommunityRole('PROVIDER')`. Un proveedor puede comentar y ver lo suyo,
//      pero abrir una incidencia es cosa de quien vive en la comunidad: el enunciado
//      pide que las tres rutas de creacion, listado y borrado esten separadas, y el
//      listado lo tiene el que sea (no lleva el guard, a proposito).
// ---------------------------------------------------------------------------

import { Router } from 'express'
import * as controller from './controller.js'
import { requireAuth, requireCommunity, requireCommunityRole } from '../auth/middleware.js'
import { requireIncident } from './middleware.js'

/**
 * Rutas con la comunidad en la URL.
 *
 * El listado NO lleva `requireCommunityRole`: es el caso de uso principal ("¿qué hay
 * abierto?") y lo necesitan todos los roles. El alcance de lo que sale lo decide
 * `app_list_incidents()`.
 *
 * El alta si lo lleva, y sin `PROVIDER`: un proveedor informa de un problema a través
 * del sistema de trabajo que le asigna el ADMIN, no abriendo partes.
 */
export function createIncidentsRouter(): Router {
  const router = Router()

  router.get('/:communityId/incidents', requireAuth, requireCommunity(), controller.listIncidents)

  router.post(
    '/:communityId/incidents',
    requireAuth,
    requireCommunity(),
    requireCommunityRole('NEIGHBOR', 'PRESIDENT', 'ADMIN'),
    controller.createIncident,
  )

  return router
}

/**
 * Rutas con la incidencia en la URL.
 *
 * `requireIncident()` sustituye a `requireCommunity()` en las seis: resuelve la
 * comunidad de la incidencia y la deja en `req.community`, con lo que el servicio y los
 * guards de rol que se añadieran despues funcionarian igual que en el resto del
 * proyecto.
 *
 * El `DELETE` no lleva `requireCommunityRole('ADMIN')` a proposito, aunque solo el
 * ADMIN pueda borrar (I-6). Razon: el 403 tiene que salir de
 * `app_soft_delete_incident()`, que comprueba el rol DENTRO de la transaccion. Un
 * guard aqui daria el mismo 403 con un mensaje peor, y si el guard se olvidara el
 * endpoint seguiria siendo seguro. Al reves —si la comprobacion viviera solo en el
 * guard— el mismo endpoint seria un agujero por el PostgREST, que no pasa por Express.
 */
export function createIncidentRouter(): Router {
  const router = Router()

  router.get('/incidents/:id', requireAuth, requireIncident(), controller.getIncident)
  router.put('/incidents/:id', requireAuth, requireIncident(), controller.updateIncident)
  router.patch('/incidents/:id/status', requireAuth, requireIncident(), controller.transitionIncident)
  router.delete('/incidents/:id', requireAuth, requireIncident(), controller.deleteIncident)
  router.get('/incidents/:id/comments', requireAuth, requireIncident(), controller.listComments)
  router.post('/incidents/:id/comments', requireAuth, requireIncident(), controller.createComment)

  return router
}