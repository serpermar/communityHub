// ---------------------------------------------------------------------------
// Servicio de avisos.
//
// Aqui vive la logica de negocio. Los controllers solo reparten peticiones y
// los repositorios solo ejecutan SQL.
//
// La autorizacion esta en dos capas y las dos se necesitan, igual que en los
// bloques 03 a 06. `requireAnnouncement()` comprueba visibilidad y resuelve el
// rol CONTRA ESTADO en las rutas sin comunidad en la URL, y las funciones de SQL
// comprueban el mismo rol DENTRO de la transaccion, en el unico sitio donde el
// motor lo ve. Un invariante que solo vive en la capa HTTP no es un invariante:
// la misma llamada se puede hacer por PostgREST.
//
// Y ninguna regla se decide leyendo filas y comparando en TypeScript: la ventana
// de AN-4/AN-7, el rol de escritura de AN-1 y el borrado exclusivo de ADMIN son
// cosas que tienen que pasar en la misma transaccion que la escritura.
// ---------------------------------------------------------------------------

import { withContext } from '../context.js'
import { notFound } from '../http/errors.js'
import type { CreateAnnouncementInput, ListQueryInput, UpdateAnnouncementInput } from './validators.js'
import * as repo from './repository.js'
import { ejecuta } from './errors.js'

/**
 * El aviso tal como sale en la API (spec 07 §7.1).
 *
 * `authorName` viene de la funcion de lectura (AN-3): es el nombre completo del
 * autor, y es null si el autor se dio de baja o su fila ya no existe. `email`
 * NO sale: para un tablón no hace falta, y añadirlo seria una segunda excepcion
 * a la regla de que los correos solo salen donde la spec los pide.
 *
 * Los instantes van como ISO 8601 UTC, que es el formato con offset que zod
 * exige tambien en la entrada: lo que entra y lo que sale es el mismo formato.
 */
export type AnnouncementView = {
  id: string
  communityId: string
  title: string
  body: string
  type: string
  priority: string
  isPinned: boolean
  publishAt: string
  expiresAt: string | null
  authorId: string | null
  authorName: string | null
  createdAt: string
  updatedAt: string
}

/** La lista con su paginacion en `meta` (AN-8). */
export type AnnouncementListView = {
  items: AnnouncementView[]
  meta: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

function toAnnouncementView(row: repo.AnnouncementListRow): AnnouncementView {
  return {
    id: row.id,
    communityId: row.community_id,
    title: row.title,
    body: row.body,
    type: row.type,
    priority: row.priority,
    isPinned: row.is_pinned,
    publishAt: row.publish_at.toISOString(),
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    authorId: row.author_id,
    authorName: row.author_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

/**
 * Traduce el total de Postgres al `meta.total` de la API.
 *
 * `total_count` viene como `bigint`, y en el cliente JSON de `pg` un `bigint`
 * llega como string, no como numero: sin esta conversion, `meta.total` seria
 * `"7"` y el frontend tendria que compararlo como texto. `Number` es seguro aqui
 * porque el total de avisos de una comunidad no llega a 2^53.
 */
function toTotal(total: bigint): number {
  return Number(total)
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/**
 * Listar los avisos de una comunidad.
 *
 * No hay ningun filtro de rol aqui. El `requireCommunity()` de la ruta comprueba
 * que el actor es miembro activo, y de que es miembro a que avisos ve hay un
 * hueco que decide `app_list_announcements()` dentro de la misma consulta
 * (AN-4/AN-7):
 *
 *   - ADMIN y PRESIDENT ven tambien los programados y los caducados.
 *   - NEIGHBOR y PROVIDER ven los publicados y no caducados.
 *   - Los borrados (AN-5) no los ve nadie.
 *
 * Por que el hueco no se cierra aqui con un `where` de Prisma: seria una segunda
 * implementacion de AN-4, con un reloj (`Date.now()`) distinto al de Postgres.
 * Y por que el total se pide a la misma funcion en vez de a un `count` aparte:
 * dos consultas son dos peticiones que pueden ver distinto, y un `meta` que no
 * cuadra con la lista es un fallo que solo aparece en la pagina 5.
 *
 * El orden (`is_pinned` primero, luego `publish_at` descendente) tambien lo pone
 * la funcion (AN-8): es el orden exacto del indice `announcements_community_publish_idx`,
 * y reimplementarlo aqui seria un orden de lista que no coincide con el indice.
 *
 * `totalPages` es un entero hacia arriba, y da 0 cuando no hay nada: un `ceil`
 * a 0 diria "pagina 1 de 0", que no le sirve a nadie.
 *
 * Y aqui esta el mismo caso feo de `incidents/service.ts`: pedir la pagina 5 de
 * un listado de 3. La funcion trae el total con `count(*) over ()`, pero una
 * ventana se evalua sobre las filas que SALEN, y si la pagina esta mas alla del
 * final no sale ninguna: no hay fila que lleve el total. El apano es una segunda
 * llamada a la MISMA funcion con `offset 0` y `limit 1`, que si devuelve una fila
 * y con ella el total real. Se hace solo cuando la pagina salio vacia y no era la
 * primera, y por la misma razon que no se hace un `count` aparte siempre: dos
 * consultas pueden ver distinto. Aqui las dos van en la misma transaccion y con
 * los mismos filtros, asi que pueden ver lo mismo.
 */
export async function listAnnouncements(
  userId: string,
  communityId: string,
  query: ListQueryInput,
): Promise<AnnouncementListView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const page = query.page ?? 1
      const limit = query.limit ?? 20
      const offset = (page - 1) * limit

      const filtros = {
        type: query.type,
        q: query.q,
      }

      const rows = await repo.listAnnouncements(tx, communityId, { ...filtros, limit, offset })

      let total = 0
      const primera = rows[0]

      if (primera) {
        total = toTotal(primera.total_count)
      } else if (offset > 0) {
        // La pagina estaba mas alla del final. Una fila de la primera pagina es
        // suficiente para traer el total, y si tampoco hay fila es que no hay
        // nada que paginar: total 0 es la respuesta correcta.
        const muestra = await repo.listAnnouncements(tx, communityId, {
          ...filtros,
          limit: 1,
          offset: 0,
        })
        const primeraMuestra = muestra[0]
        total = primeraMuestra ? toTotal(primeraMuestra.total_count) : 0
      }

      return {
        items: rows.map(toAnnouncementView),
        meta: {
          page,
          limit,
          total,
          totalPages: total === 0 ? 0 : Math.ceil(total / limit),
        },
      }
    }),
  )
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

/**
 * Alta de un aviso (AN-1, solo PRESIDENT y ADMIN).
 *
 * El rol lo comprueba `requireCommunityRole('PRESIDENT', 'ADMIN')` en la ruta y
 * LO MISMO, otra vez, `app_create_announcement()` dentro de la transaccion: si
 * el guard desapareciera, el endpoint seguira seguro. Los defaults (tipo
 * `GENERAL`, prioridad `MEDIUM`, `publishAt = now()`, sin caducidad) los pone la
 * funcion, no aqui, para que "no lo mandaste" y "lo mandaste igual que el
 * default" acaben en el mismo sitio.
 *
 * La respuesta se relee con `findAnnouncement()` en vez de montarla con los
 * parametros de entrada: es la unica forma de que `authorName` salga en el 201
 * (AN-3), y de que lo que devuelve la API sea lo que quedo escrito, con los
 * `btrim` y los `coalesce` ya aplicados.
 *
 * Se relee por la MISMA funcion de listado con el id puesto, y la ventana de
 * AN-7 no puede esconder el recien creado: el actor es PRESIDENT o ADMIN, y a
 * esos la ventana no se aplica.
 */
export async function createAnnouncement(
  userId: string,
  communityId: string,
  input: CreateAnnouncementInput,
): Promise<AnnouncementView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const id = await repo.createAnnouncement(tx, communityId, input)

      const row = await repo.findAnnouncement(tx, communityId, id)

      if (!row) {
        // Acaba de insertarse y la propia funcion deja leerlo. Si no aparece,
        // algo se ha roto por debajo; un 404 seria mentira porque si que existe.
        throw new Error('El aviso se creó pero no se puede leer.')
      }

      return toAnnouncementView(row)
    }),
  )
}

/**
 * Reescribir un aviso (PUT, AN-6, solo PRESIDENT y ADMIN).
 *
 * El PUT es reemplazo completo de los ocho campos; los obligatorios ya los exige
 * zod antes de llegar aqui. `authorId` y `communityId` no viajan y la funcion no
 * los toca (AN-9): un PUT no puede reasignar un aviso a otro autor ni moverlo
 * de comunidad.
 *
 * La respuesta se relee, igual que en el alta, por el mismo motivo. Y el 404 del
 * `if (!row)` de abajo es el caso raro: entre el UPDATE y la relectura, otra
 * transaccion habria tenido que borrarlo. El 404 normal (aviso que no existe o
 * no es visible) lo pone la funcion con `announcement_not_found`, y lo traduce
 * `errors.ts` antes de que llegue aqui.
 */
export async function updateAnnouncement(
  userId: string,
  communityId: string,
  announcementId: string,
  input: UpdateAnnouncementInput,
): Promise<AnnouncementView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      await repo.updateAnnouncement(tx, announcementId, input)

      const row = await repo.findAnnouncement(tx, communityId, announcementId)

      if (!row) {
        throw notFound('Ese aviso no existe.')
      }

      return toAnnouncementView(row)
    }),
  )
}

/**
 * Borrado logico de un aviso (AN-5, solo ADMIN).
 *
 * Devuelve `void`: el controller responde 200 con `{ id, deleted: true }`, no la
 * incidencia con `deleted_at` puesto. Una vez borrado, para el cliente no existe
 * (su GET da 404), y devolver la fila seria contradiciendo eso.
 *
 * El rol NO se comprueba aqui: ya lo hace `app_delete_announcement()` con
 * `announcement_requires_admin` (42501 -> 403), y una comprobacion en
 * TypeScript seria una segunda copia de la regla que puede desincronizarse de
 * la primera. El `requireAnnouncement()` de la ruta ya ha puesto 404 si no se
 * ve, y la funcion lo vuelve a comprobar: el segundo borrado es un 404, no un
 * 200 idempotente (AN-11: tampoco es un 409).
 */
export async function deleteAnnouncement(
  userId: string,
  communityId: string,
  announcementId: string,
): Promise<void> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      await repo.deleteAnnouncement(tx, announcementId)
    }),
  )
}
