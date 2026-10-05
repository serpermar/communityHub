// ---------------------------------------------------------------------------
// Controller de incidencias.
//
// Su unico trabajo es traducir HTTP a llamadas al servicio y volver. No decide nada:
// si aparece una condicion de negocio aqui, es que esta en el sitio equivocado.
//
// En concreto, este archivo NO sabe quien puede cambiar una prioridad ni quien puede
// transicionar un estado. Eso lo deciden `app_set_incident_priority()` y
// `app_transition_incident()` dentro de la transaccion, y en el caso del PUT tambien
// una primera comprobacion en `service.updateIncident()`.
//
// Lo unico que se comprueba aqui es la FORMA de lo que llega, que es una preocupacion de
// HTTP: los UUID de ruta, el esquema del cuerpo y los query params.
//
// Sobre la comunidad: las rutas de incidencia no la llevan en la URL, asi que no se
// puede leer de `req.params`. Viene en `req.community`, que escribe `requireIncident()`.
// Sin ese middleware, `req.community` seria undefined y estas rutas darian un 400
// "peticion sin contexto" en vez de un 404, que es lo que pasaria si alguien montara
// estas rutas sin el guard.
//
// `routeParam` + el mismo `parse` que usan los demas modulos, y no una lectura directa
// de `req.params`: los tipos de Express 5 tipan `req.params` como `string | string[]`,
// y propagar ese tipo por todo el archivo no ayuda a nadie.
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express'
import { badRequest } from '../http/errors.js'
import { created, noContent, ok } from '../http/envelope.js'
import { formatIssues } from '../auth/validators.js'
import type { ZodType } from 'zod'
import * as service from './service.js'
import {
  createCommentSchema,
  createIncidentSchema,
  listQuerySchema,
  transitionIncidentSchema,
  updateIncidentSchema,
  uuidSchema,
} from './validators.js'
import { routeParam } from '../auth/middleware.js'

function parse<T>(schema: ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload)

  if (!result.success) {
    throw badRequest('Los datos enviados no son válidos.', formatIssues(result.error))
  }

  return result.data
}

/**
 * Un UUID de ruta, o un 400 que lo diga (C-9).
 *
 * El middleware `requireIncident()` ya lo comprueba, asi que en las rutas de incidencia
 * esta funcion es la segunda comprobacion. Se deja igualmente por dos razones: las
 * rutas de comunidad (listado y alta) no llevan `:incidentId` pero si llevan
 * `:communityId`, y una funcion de ahi que se apoyara en el middleware no tendria
 * donde fallar si alguien la reutiliza. El coste de tenerla es una regex.
 */
function uuidParam(req: Request, name: string): string {
  return parse(uuidSchema, routeParam(req, name))
}

/** El `userId` y el rol ya los ha puesto el middleware. Si no, no deberia estar aqui. */
function actor(req: Request): { userId: string; communityId: string; role: string } {
  if (!req.auth) {
    throw badRequest('Petición sin sesión.')
  }

  if (!req.community) {
    // Solo alcanzable si se montara la ruta sin `requireIncident()` o sin
    // `requireCommunity()`. Un 400 explicito es mejor que un 500 con un undefined
    // dentro del SQL.
    throw badRequest('Petición sin contexto de comunidad.')
  }

  return { userId: req.auth.userId, communityId: req.community.communityId, role: req.community.role }
}

// ---------------------------------------------------------------------------
// Rutas con :communityId en la URL
// ---------------------------------------------------------------------------

/**
 * `GET /communities/:communityId/incidents`
 *
 * El `role` de `req.community` no se mira aqui: `app_list_incidents()` decide el
 * alcance de la lista. Es la unica forma de que un NEIGHBOR y un ADMIN puedan pedir la
 * MISMA ruta y obtener cosas distintas, que es justo el caso de uso de la app.
 */
export async function listIncidents(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = actor(req)
    const query = parse(listQuerySchema, req.query)

    const resultado = await service.listIncidents(userId, communityId, query)

    ok(res, resultado.items, resultado.meta)
  } catch (error) {
    next(error)
  }
}

/**
 * `POST /communities/:communityId/incidents`
 *
 * Con `Location` a la incidencia recien creada. Va DESPUES de la escritura y no en
 * lugar del 201, como el resto de datos: es informacion extra, no sustituta de la
 * respuesta, que ademas lleva la incidencia completa para no obligar al cliente a una
 * segunda peticion.
 */
export async function createIncident(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = actor(req)
    const input = parse(createIncidentSchema, req.body)

    const incident = await service.createIncident(userId, communityId, input)

    res.setHeader('Location', `/api/v1/incidents/${incident.id}`)
    created(res, incident)
  } catch (error) {
    next(error)
  }
}

// ---------------------------------------------------------------------------
// Rutas con :incidentId
// ---------------------------------------------------------------------------

/** `GET /incidents/:id` */
export async function getIncident(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = actor(req)
    const incidentId = uuidParam(req, 'id')

    ok(res, await service.getIncident(userId, communityId, incidentId))
  } catch (error) {
    next(error)
  }
}

/**
 * `PUT /incidents/:id`
 *
 * El `role` se pasa al servicio porque es el unico sitio de todo el bloque que lo
 * necesita, y lo necesita para una primera comprobacion de `priority` y
 * `assignedToId` (ver `service.updateIncident()`). Lo lee de `req.community`, que
 * `requireIncident()` resolvio contra la fila.
 */
export async function updateIncident(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId, role } = actor(req)
    const incidentId = uuidParam(req, 'id')
    const input = parse(updateIncidentSchema, req.body)

    ok(res, await service.updateIncident(userId, communityId, incidentId, role, input))
  } catch (error) {
    next(error)
  }
}

/** `PATCH /incidents/:id/status`. El 409 del grafo sale de la funcion, no de aqui. */
export async function transitionIncident(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = actor(req)
    const incidentId = uuidParam(req, 'id')
    const input = parse(transitionIncidentSchema, req.body)

    ok(res, await service.transitionIncident(userId, communityId, incidentId, input))
  } catch (error) {
    next(error)
  }
}

/**
 * `DELETE /incidents/:id`
 *
 * 204 sin cuerpo. No se devuelve la incidencia con `deleted_at` puesto: una vez
 * borrada, para el cliente no existe, y su GET daria 404.
 */
export async function deleteIncident(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = actor(req)
    const incidentId = uuidParam(req, 'id')

    await service.deleteIncident(userId, communityId, incidentId)

    noContent(res)
  } catch (error) {
    next(error)
  }
}

/** `GET /incidents/:id/comments` */
export async function listComments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = actor(req)
    const incidentId = uuidParam(req, 'id')

    ok(res, await service.listComments(userId, communityId, incidentId))
  } catch (error) {
    next(error)
  }
}

/** `POST /incidents/:id/comments`. El autor es el actor y no se manda en el cuerpo. */
export async function createComment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = actor(req)
    const incidentId = uuidParam(req, 'id')
    const input = parse(createCommentSchema, req.body)

    const comment = await service.createComment(userId, communityId, incidentId, input)

    res.setHeader('Location', `/api/v1/incidents/${incidentId}/comments/${comment.id}`)
    created(res, comment)
  } catch (error) {
    next(error)
  }
}