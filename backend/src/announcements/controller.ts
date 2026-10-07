// ---------------------------------------------------------------------------
// Controller de avisos.
//
// Su unico trabajo es traducir HTTP a llamadas al servicio y volver. No decide
// nada: si aparece una condicion de negocio aqui, es que esta en el sitio
// equivocado.
//
// En concreto, este archivo NO sabe quien puede crear avisos ni quien puede
// borrarlos. Eso lo deciden `app_create_announcement()` y
// `app_delete_announcement()` dentro de la transaccion, con una primera capa en
// los guards de la ruta (`requireCommunityRole` en las rutas con comunidad,
// `requireAnnouncement` en las de id). Lo unico que se comprueba aqui es la
// FORMA de lo que llega: los UUID de ruta, el esquema del cuerpo y los query
// params del listado.
//
// Sobre la comunidad: `PUT /announcements/:id` y `DELETE /announcements/:id` no
// la llevan en la URL, asi que no se puede leer de `req.params`. Viene en
// `req.community`, que escribe `requireAnnouncement()`. Sin ese middleware,
// `req.community` seria undefined y estas rutas darian un 400 "peticion sin
// contexto" en vez del 404 que corresponde, que es lo que pasaria si alguien
// montara estas rutas sin el guard.
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
import { createAnnouncementSchema, listQuerySchema, updateAnnouncementSchema, uuidSchema } from './validators.js'
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
 * El middleware `requireAnnouncement()` ya lo comprueba, asi que en las dos
 * rutas de aviso esta funcion es la segunda comprobacion. Se deja igualmente
 * porque el controller es la frontera de la forma y no debe confiar en que el
 * guard exista.
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
    // `requireAnnouncement()`. Un 400 explicito es mejor que un 500 con un
    // undefined dentro del SQL.
    throw badRequest('Petición sin contexto de comunidad.')
  }

  return { userId: req.auth.userId, communityId: req.community.communityId }
}

// ---------------------------------------------------------------------------
// Rutas con :communityId en la URL
// ---------------------------------------------------------------------------

/**
 * `GET /communities/:communityId/announcements?type=&q=&page=&limit=`
 *
 * El rol no se mira aqui: leer avisos es de cualquier miembro activo, y
 * `app_list_announcements()` es quien aplica la ventana por rol (AN-4/AN-7).
 *
 * Los filtros van por query param y no por cuerpo: es un GET, y un GET con
 * cuerpo no se cachea, no se comparte en un enlace y no lo entiende un
 * cliente normal. Ademas `?type=URGENT` es la forma en que la documentacion
 * de la spec §7.3 los escribe.
 */
export async function listAnnouncements(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = actor(req)
    const query = parse(listQuerySchema, req.query)

    const resultado = await service.listAnnouncements(userId, communityId, query)

    ok(res, resultado.items, resultado.meta)
  } catch (error) {
    next(error)
  }
}

/**
 * `POST /communities/:communityId/announcements`
 *
 * El rol (PRESIDENT o ADMIN, AN-1) lo pone `requireCommunityRole` en la ruta y
 * lo repite la funcion dentro de la transaccion.
 *
 * Sin `Location`: la API no expone `GET /announcements/:id` como endpoint
 * (ARCHITECTURE.md §6), y un Location que apuntara a una ruta inexistente seria
 * peor que no ponerlo. La respuesta lleva el aviso entero con su `authorName`,
 * que es lo que el cliente necesita para pintarlo.
 */
export async function createAnnouncement(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = actor(req)
    const input = parse(createAnnouncementSchema, req.body)

    created(res, await service.createAnnouncement(userId, communityId, input))
  } catch (error) {
    next(error)
  }
}

// ---------------------------------------------------------------------------
// Rutas con :id de aviso
// ---------------------------------------------------------------------------

/** `PUT /announcements/:id`. Reemplazo completo (AN-6): no hay PATCH. */
export async function updateAnnouncement(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = actor(req)
    const announcementId = uuidParam(req, 'id')
    const input = parse(updateAnnouncementSchema, req.body)

    ok(res, await service.updateAnnouncement(userId, communityId, announcementId, input))
  } catch (error) {
    next(error)
  }
}

/**
 * `DELETE /announcements/:id`
 *
 * 200 con `{ id, deleted: true }` y no 204: lo que fija la spec 07 §10 es
 * "Un ADMIN borra: 200", y 204 no lleva cuerpo donde confirmar que. Es el unico
 * DELETE de la API que responde con algo; los demas (incidencias) devuelven 204,
 * y la diferencia esta en la spec de cada bloque, no en este archivo. El cuerpo
 * es minimo a proposit: `deleted: true` es un confirmado, no la fila borrada,
 * que para el cliente ya no existe.
 *
 * El rol (solo ADMIN, AN-5) lo decide `app_delete_announcement()`. El
 * segundo borrado es 404, no 200 idempotente ni 409 (AN-11).
 */
export async function deleteAnnouncement(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = actor(req)
    const announcementId = uuidParam(req, 'id')

    await service.deleteAnnouncement(userId, communityId, announcementId)

    ok(res, { id: announcementId, deleted: true })
  } catch (error) {
    next(error)
  }
}
