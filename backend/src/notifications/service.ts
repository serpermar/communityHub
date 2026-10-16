// ---------------------------------------------------------------------------
// Servicio de notificaciones.
//
// Aqui no hay autorizacion: la RLS `notifications_own` (02_rls §5.17) ya acota
// cada consulta a las filas del usuario. No hay ningun `if (userId === ...)`:
// seria una segunda copia de una regla que el motor ya aplica.
//
// Lo unico que decide este modulo es el 404 del marcado: un UPDATE que afecta
// cero filas significa "no existe o no es tuya", y las dos se responden 404
// (nunca 403), porque la RLS hace que una notificacion ajena sea invisible.
// ---------------------------------------------------------------------------

import { withContext } from '../context.js'
import { notFound } from '../http/errors.js'
import * as repo from './repository.js'
import type { ListQueryInput } from './validators.js'

/** El contrato con el frontend (spec 14 §5.1). */
export type NotificationView = {
  id: string
  type: string
  title: string
  body: string | null
  payload: unknown | null
  communityId: string | null
  readAt: string | null
  createdAt: string
}

/** La lista con su paginacion en `meta` (NTF-5). */
export type NotificationPage = {
  items: NotificationView[]
  meta: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

function toView(row: repo.NotificationRow): NotificationView {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    payload: row.payload,
    communityId: row.community_id,
    readAt: row.read_at ? row.read_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  }
}

/**
 * Traduce el total de Postgres al `meta.total` de la API.
 *
 * `total_count` viene como `bigint`, y en un `$queryRaw` de Prisma llega como
 * `BigInt`, no como numero; sin esta conversion, `meta.total` seria un `BigInt`
 * y JSON.stringify reventaria. `Number` es seguro: el total de notificaciones de
 * un usuario no llega a 2^53.
 */
function toTotal(total: bigint): number {
  return Number(total)
}

/** Las notificaciones del usuario, mas nuevas primero (NTF-3, NTF-5). */
export async function listNotifications(
  userId: string,
  query: ListQueryInput,
): Promise<NotificationPage> {
  const offset = (query.page - 1) * query.limit

  return withContext({ userId, communityId: null }, async (tx) => {
    const rows = await repo.listNotifications(tx, query.unread, query.limit, offset)

    const total = rows[0] ? toTotal(rows[0].total_count) : 0

    return {
      items: rows.map(toView),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
      },
    }
  })
}

/** El numero de no leidas, para el *badge* de la campana. */
export async function unreadCount(userId: string): Promise<number> {
  return withContext({ userId, communityId: null }, (tx) => repo.countUnread(tx))
}

/**
 * Marca una notificacion como leida. Idempotente (spec 14 §6.3); si el UPDATE
 * no toca ninguna fila, la notificacion no existe o no es del usuario: 404.
 */
export async function markRead(userId: string, id: string): Promise<NotificationView> {
  return withContext({ userId, communityId: null }, async (tx) => {
    const row = await repo.markRead(tx, id)

    if (!row) {
      throw notFound('Esa notificación no existe.')
    }

    return toView(row)
  })
}

/** Marca todas como leidas. Devuelve cuantas cambio (`updated`, NTF-6). */
export async function readAll(userId: string): Promise<number> {
  return withContext({ userId, communityId: null }, (tx) => repo.markAllRead(tx))
}
