// ---------------------------------------------------------------------------
// Controller de zonas comunes.
//
// Su unico trabajo es traducir HTTP a llamadas al servicio y volver. No decide
// nada: si aparece una condicion de negocio aqui, es que esta en el sitio
// equivocado.
//
// En concreto, este archivo NO sabe quien puede crear zonas ni quien puede
// reconfigurarlas. Eso lo deciden `app_create_common_area()` y
// `app_update_common_area()` dentro de la transaccion, con una primera capa en
// el guard de la ruta. Lo unico que se comprueba aqui es la FORMA de lo que
// llega: los UUID de ruta, el esquema del cuerpo y el query param de fecha.
//
// Sobre la comunidad: `PUT /common-areas/:id` y el `GET` de disponibilidad no
// la llevan en la URL, asi que no se puede leer de `req.params`. Viene en
// `req.community`, que escribe `requireCommonArea()`. Sin ese middleware,
// `req.community` seria undefined y estas rutas darian un 400 "peticion sin
// contexto" en vez de un 404, que es lo que pasaria si alguien montara estas
// rutas sin el guard.
//
// `routeParam` + el mismo `parse` que usan los demas modulos, y no una lectura
// directa de `req.params`: los tipos de Express 5 tipan `req.params` como
// `string | string[]`, y propagar ese tipo por todo el archivo no ayuda a
// nadie.
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express'
import { badRequest } from '../http/errors.js'
import { created, ok } from '../http/envelope.js'
import { formatIssues } from '../auth/validators.js'
import type { ZodType } from 'zod'
import * as service from './service.js'
import {
  availabilityQuerySchema,
  createCommonAreaSchema,
  updateCommonAreaSchema,
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
 * El middleware `requireCommonArea()` ya lo comprueba, asi que en las dos rutas
 * de zona esta funcion es la segunda comprobacion. Se deja igualmente porque el
 * controller es la frontera de la forma y no debe confiar en que el guard
 * exista.
 */
function uuidParam(req: Request, name: string): string {
  return parse(uuidSchema, routeParam(req, name))
}

/** El `userId` y la comunidad ya los ha puesto el middleware. Si no, no deberia estar aqui. */
function actor(req: Request): { userId: string; communityId: string } {
  if (!req.auth) {
    throw badRequest('Petición sin sesión.')
  }

  if (!req.community) {
    // Solo alcanzable si se montara la ruta sin `requireCommunity()` o sin
    // `requireCommonArea()`. Un 400 explicito es mejor que un 500 con un
    // undefined dentro del SQL.
    throw badRequest('Petición sin contexto de comunidad.')
  }

  return { userId: req.auth.userId, communityId: req.community.communityId }
}

// ---------------------------------------------------------------------------
// Rutas con :communityId en la URL
// ---------------------------------------------------------------------------

/**
 * `GET /communities/:communityId/common-areas`
 *
 * El rol no se mira aqui: leer zonas es de cualquier miembro activo (CA-1) y
 * `app_list_common_areas()` es quien lo comprueba.
 */
export async function listCommonAreas(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = actor(req)

    ok(res, await service.listCommonAreas(userId, communityId))
  } catch (error) {
    next(error)
  }
}

/**
 * `POST /communities/:communityId/common-areas`
 *
 * Sin `Location`: la API no expone `GET /common-areas/:id` como endpoint
 * (ARCHITECTURE.md §6), y un Location que apuntara a una ruta inexistente seria
 * peor que no ponerlo. La respuesta lleva la zona entera, que es lo que el
 * cliente necesita para pintarla.
 */
export async function createCommonArea(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = actor(req)
    const input = parse(createCommonAreaSchema, req.body)

    created(res, await service.createCommonArea(userId, communityId, input))
  } catch (error) {
    next(error)
  }
}

// ---------------------------------------------------------------------------
// Rutas con :id de zona
// ---------------------------------------------------------------------------

/** `PUT /common-areas/:id`. Reemplazo completo (CA-4): no hay PATCH. */
export async function updateCommonArea(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = actor(req)
    const areaId = uuidParam(req, 'id')
    const input = parse(updateCommonAreaSchema, req.body)

    ok(res, await service.updateCommonArea(userId, communityId, areaId, input))
  } catch (error) {
    next(error)
  }
}

/**
 * `GET /common-areas/:id/availability?date=YYYY-MM-DD`
 *
 * La fecha es obligatoria y con formato estricto: un `?date` ausente o con
 * `2026-2-5` es un 400 de zod, no una fecha que se adivina. Aceptar variantes
 * haria que dos clientes pidieran "el mismo dia" y el backend resolviera dias
 * distintos.
 */
export async function getAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = actor(req)
    const areaId = uuidParam(req, 'id')
    const query = parse(availabilityQuerySchema, req.query)

    ok(res, await service.getAvailability(userId, communityId, areaId, query))
  } catch (error) {
    next(error)
  }
}
