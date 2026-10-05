// ---------------------------------------------------------------------------
// Acceso a datos de incidencias.
//
// Es el unico sitio del modulo que escribe SQL. Todas las funciones reciben el cliente
// de transaccion, nunca el singleton: por construccion no se puede leer nada fuera
// del contexto de RLS.
//
// TODO de este archivo va por SQL a mano, sin excepciones, y no es una manía:
//
//   - app_runtime no tiene INSERT ni UPDATE sobre `incidents` (02e los revoca), asi
//     que el cliente de Prisma no puede escribir en la tabla ni de broma.
//   - Las lecturas necesitan `reporter_name` y `assigned_name` (D-2), que salen de
//     `users`, y `users_select_self` deja leer solo la propia fila.
//   - El listado necesita el predicado de visibilidad POR FILA (I-1), que es un
//     predicado de SQL y no un `where` de TypeScript.
//
// Un `SELECT` con la politica seria mas corto, pero solo para las lecturas simples, y
// mezclar las dos cosas en el mismo archivo haria que un dia alguien escribiera un
// `findUnique` creyendo que la politica hace lo que hace aqui.
//
// Ninguna consulta lleva un valor del cliente dentro de un `Prisma.raw`: los nombres de
// columna van LITERALMENTE en la plantilla, porque en `$queryRaw` cualquier cosa metida
// en `${}` viaja como parametro ligado, no como SQL. Una constante de texto ahi se
// convierte en `select $1, ...`, que es un error de tipo y un 500.
// ---------------------------------------------------------------------------

import { type Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

/**
 * Una fila de lectura de incidencia, tal como la devuelven las funciones de 02e.
 *
 * Los nombres van en `snake_case` porque son los de las columnas y los de los
 * `returns table`. El `service.ts` es quien los traduce a camelCase para la API, y el
 * unico sitio donde se decide ese mapeo.
 *
 * `reporter_name` y `assigned_name` vienen de `users` y NO estan en la tabla: es el
 * motivo de que estas lecturas sean funciones y no un `SELECT` (D-2, I-11).
 *
 * `total_count` solo viene en `app_list_incidents()`, y es el total SIN paginar (I-12).
 */
export type IncidentRow = {
  id: string
  community_id: string
  reference_code: string
  title: string
  description: string
  category: string
  priority: string
  status: string
  location: string | null
  reporter_id: string
  reporter_name: string | null
  assigned_to_id: string | null
  assigned_name: string | null
  needs_review: boolean
  created_via: string
  resolved_at: Date | null
  created_at: Date
  updated_at: Date
}

/** Una fila de lectura del listado, que es `IncidentRow` mas el total. */
export type IncidentListRow = IncidentRow & { total_count: bigint }

/** Una fila de `app_list_incident_comments()`. */
export type CommentRow = {
  id: string
  incident_id: string
  author_id: string
  author_name: string | null
  body: string
  created_at: Date
}

/**
 * Listar incidencias de una comunidad.
 *
 * Toda la autorizacion esta dentro de la funcion: pertenencia (403 si no se es
 * miembro) y visibilidad por rol fila a fila (I-1). Aqui no hay ningun filtro de rol
 * en TypeScript, y no por descuido: un filtro en el codigo seria una segunda
 * implementacion de I-1 que se puede desincronizar de la de SQL.
 *
 * `page` y `limit` se convierten en `offset` y `limit` aqui y no en el service, que
 * es donde se traducen los numeros de `meta`. La funcion acota el `limit` a 100 por si
 * misma, asi que un `limit` enorme no llega a ser un problema aunque se saltara el
 * zod.
 *
 * Las columnas van LITERALES en la plantilla, no en una constante interpolada: es la
 * regla de la cabecera, y aqui hay una razon mas. El orden de un `select *` sobre una
 * funcion que devuelve TABLE sale del orden de sus parametros de salida, que es un
 * detalle de la definicion SQL que no se ve al leer el TypeScript. Escritas una a una,
 * un cambio en la funcion rompe el typecheck en vez de devolver las columnas cruzadas
 * en silencio.
 */
export async function listIncidents(
  tx: Tx,
  communityId: string,
  filtros: {
    status?: string
    priority?: string
    category?: string
    q?: string
    limit: number
    offset: number
  },
): Promise<IncidentListRow[]> {
  return tx.$queryRaw<IncidentListRow[]>`
    select
      id, community_id, reference_code, title, description,
      category, priority, status, location,
      reporter_id, reporter_name, assigned_to_id, assigned_name,
      needs_review, created_via, resolved_at, created_at, updated_at,
      total_count
      from app_list_incidents(
        ${communityId}::uuid,
        ${filtros.status ?? null}::incident_status,
        ${filtros.priority ?? null}::incident_priority,
        ${filtros.category ?? null}::incident_category,
        ${filtros.q ?? null},
        ${filtros.limit}::integer,
        ${filtros.offset}::integer
      )
  `
}

/** Una incidencia concreta, o null si no existe o no es visible. Que el 0 filas sea 404 lo decide el service. */
export async function findIncident(tx: Tx, incidentId: string): Promise<IncidentRow | null> {
  const rows = await tx.$queryRaw<IncidentRow[]>`
    select
      id, community_id, reference_code, title, description,
      category, priority, status, location,
      reporter_id, reporter_name, assigned_to_id, assigned_name,
      needs_review, created_via, resolved_at, created_at, updated_at
      from app_get_incident(${incidentId}::uuid)
  `

  return rows[0] ?? null
}

/** Comentarios de una incidencia, en orden cronologico. */
export async function listComments(tx: Tx, incidentId: string): Promise<CommentRow[]> {
  return tx.$queryRaw<CommentRow[]>`
    select id, incident_id, author_id, author_name, body, created_at
      from app_list_incident_comments(${incidentId}::uuid)
  `
}

/**
 * Crear una incidencia y devolver su id.
 *
 * `$queryRaw` y no `$executeRaw` porque la funcion devuelve `uuid`.
 *
 * Los casts `::incident_category` y `::incident_priority` son obligatorios. Sin ellos
 * el texto llegaria como `text` y Postgres no lo convertiria al enum solo. El enum
 * tambien lo valida zod, asi que el 22P02 es una segunda linea de defensa, no la
 * primera: llega vacio o con un valor de otra peticion.
 */
export async function createIncident(
  tx: Tx,
  communityId: string,
  input: {
    title: string
    description: string
    category?: string
    priority?: string
    location?: string | null
  },
): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    select app_create_incident(
      ${communityId}::uuid,
      ${input.title},
      ${input.description},
      ${input.category ?? 'OTHER'}::incident_category,
      ${input.priority ?? 'MEDIUM'}::incident_priority,
      ${input.location ?? null}
    ) as id
  `

  const row = rows[0]

  if (!row?.id) {
    throw new Error('app_create_incident() no devolvió el id')
  }

  return row.id
}

/**
 * Editar el contenido.
 *
 * `$executeRaw` porque la funcion devuelve `void`: no hay nada que mapear y lo unico
 * que interesa es "ha fallado o no".
 *
 * La funcion NO acepta `priority` ni `assigned_to_id` ni `status`, y por eso no hay
 * forma de que este `UPDATE` los toque (I-12). Los tres tienen su propia funcion.
 */
export async function updateContent(
  tx: Tx,
  incidentId: string,
  input: { title: string; description: string; category: string; location?: string | null },
): Promise<void> {
  await tx.$executeRaw`
    select app_update_incident_content(
      ${incidentId}::uuid,
      ${input.title},
      ${input.description},
      ${input.category}::incident_category,
      ${input.location ?? null}
    )
  `
}

/**
 * Cambiar la prioridad (solo ADMIN, I-8).
 *
 * Devuelve `void` a proposito: se relee la incidencia despues con
 * `app_get_incident()`, en la misma transaccion, para que la respuesta diga el estado
 * real y no una suposicion. Inventar aqui el resultado seria la forma de que la
 * respuesta y la tabla discrepen.
 */
export async function setPriority(tx: Tx, incidentId: string, priority: string): Promise<void> {
  await tx.$executeRaw`select app_set_incident_priority(${incidentId}::uuid, ${priority}::incident_priority)`
}

/**
 * Asignar o desasignar (solo ADMIN, I-4).
 *
 * Un `null` en un `${...}::uuid` viaja como parametro ligado NULL, que es lo que
 * quiere decir "desasignar". Un string vacio no serviria: `''::uuid` revienta con
 * 22P02.
 */
export async function assign(tx: Tx, incidentId: string, providerUserId: string | null): Promise<void> {
  await tx.$executeRaw`select app_assign_incident(${incidentId}::uuid, ${providerUserId}::uuid)`
}

/**
 * Transicionar el estado.
 *
 * El grafo y el orden de las guardas viven DENTRO de la funcion. Este `UPDATE` no
 * mira ni el estado actual ni el rol: solo lanza la funcion y traduce su error.
 *
 * El `22023` con sentinel `incident_invalid_transition` es el 409, y sale de la propia
 * base de datos: el grafo no se puede decidir en TypeScript sin abrir una segunda
 * transaccion que deja pasar a otro actor entre la comprobacion y el UPDATE.
 */
export async function transition(tx: Tx, incidentId: string, status: string): Promise<void> {
  await tx.$executeRaw`select app_transition_incident(${incidentId}::uuid, ${status}::incident_status)`
}

/** Borrado lógico (solo ADMIN, I-6). */
export async function softDelete(tx: Tx, incidentId: string): Promise<void> {
  await tx.$executeRaw`select app_soft_delete_incident(${incidentId}::uuid)`
}

/**
 * Crear un comentario.
 *
 * A diferencia de todo lo demas de este archivo, SI va por el cliente de Prisma, y
 * no por una funcion, y es una excepcion consciente (spec 04, seccion 6):
 *
 * `app_runtime` conserva el INSERT sobre `incident_comments`, y su politica
 * `comments_insert_author` comprueba lo unico que hay que comprobar: que `author_id`
 * sea el actor y que la incidencia sea visible. No hay ninguna regla de dominio en un
 * comentario —no hay estado, ni prioridad, ni transiciones— asi que una funcion
 * seria una capa sin nada que decidir.
 *
 * Y no por eso se saltan las guardas: el `where` lleva `incident_id` y la politica
 * resuelve el alcance. Si alguien relajara la politica, esto seguiria escribiendo
 * comentarios en incidencias ajenas, que es exactamente el motivo por el que el
 * modulo 02d repite el patron: un permiso que solo existe en el codigo no es un
 * permiso.
 */
export async function createComment(tx: Tx, incidentId: string, authorId: string, body: string): Promise<string> {
  const row = await tx.incidentComments.create({
    data: { incident_id: incidentId, author_id: authorId, body },
    select: { id: true },
  })

  return row.id
}