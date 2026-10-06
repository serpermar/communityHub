// ---------------------------------------------------------------------------
// Controller de reservas.
//
// Su unico trabajo es traducir HTTP a llamadas al servicio y volver. No decide
// nada: si aparece una condicion de negocio aqui, es que esta en el sitio
// equivocado.
//
// En concreto, este archivo NO sabe quien puede confirmar, quien puede
// cancelar, ni si un hueco esta libre. Eso lo deciden
// `app_create_reservation()`, `app_confirm_reservation()` y
// `app_cancel_reservation()` dentro de la transaccion, y en el caso de la alta
// una primera capa en el guard de la ruta. Lo unico que se comprueba aqui es la
// FORMA de lo que llega: los UUID de ruta, el esquema del cuerpo y los filtros.
//
// Sobre la comunidad: cuatro de las seis rutas no la llevan en la URL, asi que
// no se puede leer de `req.params`. Viene en `req.community`, que escribe
// `requireReservation()` (o `requireCommonArea()` en la alta). Sin esos
// middleware, `req.community` seria undefined y estas rutas darian un 400
// "peticion sin contexto" en vez de un 404, que es lo que pasaria si alguien
// montara estas rutas sin el guard.
//
// `routeParam` + el mismo `parse` que usan los demas modulos, y no una lectura
// directa de `req.params`: los tipos de Express 5 tipan `req.params` como
// `string | string[]`, y propagar ese tipo por todo el archivo no ayuda a nadie.
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express'
import { badRequest } from '../http/errors.js'
import { created, ok } from '../http/envelope.js'
import { formatIssues } from '../auth/validators.js'
import type { ZodType } from 'zod'
import * as service from './service.js'
import {
  createReservationSchema,
  emptyBodySchema,
  listQuerySchema,
  meQuerySchema,
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
 * Los guards (`requireReservation()`, `requireCommonArea()`) ya lo comprueban
 * antes, asi que en estas rutas esta funcion es la segunda comprobacion. Se deja
 * igualmente porque el controller es la frontera de la forma y no debe confiar
 * en que el guard exista: si alguien montara el router sin el guard, un
 * `::uuid` sobre texto invalido reventaria con 22P02.
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
    // Solo alcanzable si se montara la ruta sin `requireReservation()` ni
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
 * `GET /communities/:communityId/reservations`
 *
 * El rol no se mira aqui: leer reservas es de cualquier miembro activo (R-5) y
 * `app_list_community_reservations()` es quien lo comprueba y quien redacta
 * `notes` por fila.
 */
export async function listReservations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = actor(req)
    const query = parse(listQuerySchema, req.query)

    const resultado = await service.listReservations(userId, communityId, query)

    ok(res, resultado.items, resultado.meta)
  } catch (error) {
    next(error)
  }
}

// ---------------------------------------------------------------------------
// Rutas sin comunidad en la URL
// ---------------------------------------------------------------------------

/**
 * `GET /reservations/me`
 *
 * No lleva comunidad: la agenda propia cruza comunidades (R-5) y el ambito lo
 * decide `app_list_user_reservations()` con `user_id = app_current_user_id()`.
 * Por eso la ruta NO pasa por `requireReservation()`: no hay recurso que
 * resolver, y `req.community` no existe —este handler tampoco lo usa.
 */
export async function listMyReservations(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.auth) {
      throw badRequest('Petición sin sesión.')
    }

    const query = parse(meQuerySchema, req.query)

    const resultado = await service.listMyReservations(req.auth.userId, query)

    ok(res, resultado.items, resultado.meta)
  } catch (error) {
    next(error)
  }
}

/** `GET /reservations/:id` */
export async function getReservation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = actor(req)
    const reservationId = uuidParam(req, 'id')

    ok(res, await service.getReservation(userId, communityId, reservationId))
  } catch (error) {
    next(error)
  }
}

/**
 * `POST /common-areas/:id/reservations`
 *
 * `requireCommonArea()` de la ruta ya ha puesto la comunidad de la zona en
 * `req.community`, con lo que este handler funciona exactamente igual que los
 * de comunidad. La pertenencia al rol (NEIGHBOR, PRESIDENT o ADMIN; no
 * PROVIDER, R-1) la comprueba el guard grueso de la ruta y la repite
 * `app_create_reservation()`.
 *
 * `Location` apunta a `/api/v1/reservations/{id}`, que es la ruta de detalle
 * que si existe (a diferencia de las zonas comunes, que no exponen `GET
 * /:id`).
 */
export async function createReservation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = actor(req)
    const areaId = uuidParam(req, 'id')
    const input = parse(createReservationSchema, req.body)

    const reservation = await service.createReservation(userId, communityId, areaId, input)

    res.setHeader('Location', `/api/v1/reservations/${reservation.id}`)
    created(res, reservation)
  } catch (error) {
    next(error)
  }
}

/**
 * `PATCH /reservations/:id/cancel`
 *
 * El cuerpo debe ser `{}` o ausente (D-3): cancelar es cancelar, no hay nada que
 * cambiar. `{ "status": "CANCELLED" }` es un 400 explicito en vez de un 200 que
 * ignora el campo, que daria al cliente la impresion de que ha funcionado.
 *
 * El dueño o ADMIN lo decide `app_cancel_reservation()` contra la fila, dentro
 * de la transaccion. Aqui no se compara `userId`.
 */
export async function cancelReservation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = actor(req)
    const reservationId = uuidParam(req, 'id')

    parse(emptyBodySchema, req.body ?? {})

    ok(res, await service.cancelReservation(userId, communityId, reservationId))
  } catch (error) {
    next(error)
  }
}

/**
 * `POST /reservations/:id/confirm`
 *
 * Solo ADMIN (R-3, D-2), y el rol lo decide `app_confirm_reservation()` dentro
 * de la transaccion. El guard grueso de la ruta no filtra por rol aqui: si lo
 * filtrara por `ADMIN` en Express, el 403 saldria de dos sitios distintos segun
 * la ruta, y la funcion seguiria necesitando su propio check para ser correcta
 * por PostgREST. Un solo dueño de la regla, que es dentro.
 *
 * El cuerpo, igual que en cancel, debe ser `{}` o ausente.
 */
export async function confirmReservation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, communityId } = actor(req)
    const reservationId = uuidParam(req, 'id')

    parse(emptyBodySchema, req.body ?? {})

    ok(res, await service.confirmReservation(userId, communityId, reservationId))
  } catch (error) {
    next(error)
  }
}
