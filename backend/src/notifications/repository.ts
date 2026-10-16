// ---------------------------------------------------------------------------
// Acceso a datos de notificaciones.
//
// La `notifications` es ESTRICTAMENTE personal: su politica (`notifications_own`,
// 02_rls §5.17) es `user_id = app_current_user_id()`. Por eso aqui NO hace falta
// ninguna funcion SECURITY DEFINER: dentro de `withContext`, un SELECT/UPDATE de
// `app_runtime` ya ve y toca solo las filas del usuario del contexto. La RLS es
// la autorizacion, no un `where` de cortesia.
//
// La generacion (el INSERT para OTRO usuario) es la unica parte que no puede
// pasar por aqui, y vive en `02o_notifications.sql`.
//
// Las columnas van literales y no `select *`: escritas una a una, un cambio en
// la tabla rompe el typecheck en vez de devolver columnas cruzadas en silencio.
// ---------------------------------------------------------------------------

import { type Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

/** Una fila de `notifications`, en snake_case (los nombres son los de la tabla). */
export type NotificationRow = {
  id: string
  type: string
  title: string
  body: string | null
  payload: unknown | null
  community_id: string | null
  read_at: Date | null
  created_at: Date
}

/** La misma fila con `total_count` (solo el listado; `count(*) over ()`). */
export type NotificationListRow = NotificationRow & { total_count: bigint }

/**
 * Las notificaciones del usuario, mas nuevas primero, con paginacion y el filtro
 * `unread` ya resuelto por zod.
 *
 * `count(*) over ()` da el total sin paginar en la MISMA pasada: es el patron de
 * todas las listas del backend (avisos, documentos, finanzas). `total_count`
 * viene repetido en cada fila; el servicio se queda con el primero.
 */
export async function listNotifications(
  tx: Tx,
  unread: boolean,
  limit: number,
  offset: number,
): Promise<NotificationListRow[]> {
  return tx.$queryRaw<NotificationListRow[]>`
    select
      id, type::text as type, title, body, payload,
      community_id, read_at, created_at,
      count(*) over () as total_count
      from notifications
     where (${unread}::boolean is not true or read_at is null)
     order by created_at desc
     limit ${limit} offset ${offset}
  `
}

/** Cuantas notificaciones sin leer tiene el usuario (para el *badge*). */
export async function countUnread(tx: Tx): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ count: number }>>`
    select count(*)::integer as count
      from notifications
     where read_at is null
  `

  return rows[0]?.count ?? 0
}

/**
 * Marcar una notificacion como leida, idempotente.
 *
 * `coalesce(read_at, now())` es lo que la hace idempotente: si ya estaba leida,
 * conserva su fecha original en vez de reescribirla. La RLS acota el UPDATE a
 * las filas del usuario, asi que una notificacion ajena o inexistente devuelve
 * cero filas (y el servicio lo traduce a 404, nunca 403).
 */
export async function markRead(tx: Tx, id: string): Promise<NotificationRow | null> {
  const rows = await tx.$queryRaw<NotificationRow[]>`
    update notifications
       set read_at = coalesce(read_at, now())
     where id = ${id}::uuid
    returning
      id, type::text as type, title, body, payload,
      community_id, read_at, created_at
  `

  return rows[0] ?? null
}

/** Marcar TODAS las no leidas del usuario. Devuelve cuantas cambio (NTF-6). */
export async function markAllRead(tx: Tx): Promise<number> {
  return tx.$executeRaw`
    update notifications
       set read_at = now()
     where read_at is null
  `
}
