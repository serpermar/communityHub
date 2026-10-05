// ---------------------------------------------------------------------------
// Servicio de incidencias.
//
// Aqui vive la logica de negocio. Los controllers solo reparten peticiones y los
// repositorios solo ejecutan SQL.
//
// La autorizacion esta en dos capas y las dos se necesitan, igual que en el bloque
// 03. `requireIncident()` comprueba el rol CONTRA ESTADO, y las funciones de SQL
// comprueban lo mismo DENTRO de la transaccion, en el unico sitio donde el motor lo
// ve. Un invariante que solo vive en la capa HTTP no es un invariante: la misma
// llamada se puede hacer por PostgREST.
//
// Y ninguna regla se decide leyendo filas y comparando en TypeScript. El grafo de
// transiciones, la pertenencia del proveedor asignado y el borrado lógico son cosas
// que tienen que pasar en la misma transaccion que la escritura, o entre una y otra se
// cuela otra peticion.
//
// UNA EXCEPCION, y es importante: la del PUT con `priority` o `assignedToId`, donde
// el servicio comprueba el rol antes de llamar a la funcion. Ahi el 403 sale de
// codigo y no de SQL. Se explica en `updateIncident`.
// ---------------------------------------------------------------------------

import { withContext } from '../context.js'
import { badRequest, forbidden, notFound } from '../http/errors.js'
import type {
  CreateCommentInput,
  CreateIncidentInput,
  ListQueryInput,
  TransitionIncidentInput,
  UpdateIncidentInput,
} from './validators.js'
import * as repo from './repository.js'
import { ejecuta } from './errors.js'

/**
 * La incidencia tal como sale en la API.
 *
 * `reporterName` y `assignedToName` vienen de la funcion de lectura (D-2). `email` NO
 * sale, a proposito: para una lista de incidencias no hace falta, y
 * `app_list_community_members()` ya es la excepcion acotada que expone correos de
 * miembros. Añadir el aqui seria abrir una segunda excepcion sin motivo.
 *
 * `referenceCode` sale porque es lo que la gente dice en voz alta ("la incidencia
 * INC-2026-000012"). Es un dato de lectura, no una ruta: el id es el que se usa en la
 * URL.
 */
export type IncidentView = {
  id: string
  communityId: string
  referenceCode: string
  title: string
  description: string
  category: string
  priority: string
  status: string
  location: string | null
  reporterId: string
  reporterName: string | null
  assignedToId: string | null
  assignedToName: string | null
  needsReview: boolean
  createdVia: string
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

/** El comentario tal como sale en la API. */
export type CommentView = {
  id: string
  incidentId: string
  authorId: string
  authorName: string | null
  body: string
  createdAt: string
}

/** La lista con su paginacion en `meta`. */
export type IncidentListView = {
  items: IncidentView[]
  meta: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

function toIncidentView(row: repo.IncidentRow): IncidentView {
  return {
    id: row.id,
    communityId: row.community_id,
    referenceCode: row.reference_code,
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    status: row.status,
    location: row.location,
    reporterId: row.reporter_id,
    reporterName: row.reporter_name,
    assignedToId: row.assigned_to_id,
    assignedToName: row.assigned_name,
    needsReview: row.needs_review,
    createdVia: row.created_via,
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

function toCommentView(row: repo.CommentRow): CommentView {
  return {
    id: row.id,
    incidentId: row.incident_id,
    authorId: row.author_id,
    authorName: row.author_name,
    body: row.body,
    createdAt: row.created_at.toISOString(),
  }
}

/**
 * Traduce el total de Postgres al `meta.total` de la API.
 *
 * `total_count` viene como `bigint`, y en el cliente JSON de `pg` un `bigint` llega
 * como string, no como numero: sin esta conversion, `meta.total` seria `"7"` y el
 * frontend tendria que compararlo como texto. `Number` es seguro aqui porque el total
 * de incidencias de una comunidad no llega a 2^53, y no hay forma de que lo alcance
 * desde esta ruta.
 */
function toTotal(total: bigint): number {
  return Number(total)
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/**
 * Listar las incidencias de una comunidad.
 *
 * No hay ningun filtro de rol aqui. El `requireCommunity()` de la ruta comprueba que
 * el actor es miembro activo, y de que es miembro a que incidencias puede ver hay un
 * hueco que decide `app_list_incidents()` dentro de la misma consulta (I-1):
 *
 *   - ADMIN y PRESIDENT ven todas.
 *   - NEIGHBOR ve las suyas.
 *   - PROVIDER ve las que tiene asignadas.
 *
* Por que el hueco no se cierra aqui con un `where` de Prisma: seria una segunda
 * implementacion de I-1. Y por que el total se pide a la misma funcion en vez de a un
 * `count` aparte: dos consultas son dos peticiones que pueden ver distinto, y un `meta`
 * que no cuadra con la lista es un fallo que solo aparece en la pagina 5.
 *
 * `total` es el total SIN paginar (I-12), que es lo unico que hace util la paginacion:
 * sin el, un listado no puede decir "eres de la pagina 3 de 5".
 *
 * `totalPages` es un entero hacia arriba, y da 0 cuando no hay nada. Un `ceil` a 0
 * haria que un listado vacio dijera "pagina 1 de 0", que no le sirve a nadie.
 *
 * Y aqui hay un caso feo que hay que tratar bien: pedir la pagina 5 de un listado de 3.
 * La funcion trae el total con `count(*) over ()`, pero una ventana se evalua sobre las
 * filas que SALEN, y si la pagina esta mas alla del final no sale ninguna: no hay fila
 * que lleve el total. Sin el apano de abajo, `meta` seria `{page: 5, total: 0,
 * totalPages: 0}` para un listado que tiene tres cosas, y el cliente se dibujaria
 * "pagina 5 de 0".
 *
 * El apano es una segunda llamada a la MISMA funcion con `offset 0` y `limit 1`, que si
 * devuelve una fila y con ella el total real. Se hace solo cuando la pagina salio vacia
 * y no era la primera, o sea en el caso raro, y por la misma razon que no se hace un
 * `count` aparte siempre: dos consultas pueden ver distinto, y un `meta` que no cuadra
 * con la lista es peor que una consulta de mas. Aqui las dos van en la misma
 * transaccion y con los mismos filtros, asi que pueden ver lo mismo.
 *
 * No es una correccion en la base de datos porque `returns table` no puede decir "cero
 * filas y total 3": el total viaja en cada fila, y sin filas no hay donde llevarlo. La
 * otra forma de arreglarlo —un segundo COUNT en SQL— obliga al service a pedir el total
 * por un canal distinto al de los datos, y es el problema que el `count(*) over ()`
 * evitaria.
 */
export async function listIncidents(userId: string, communityId: string, query: ListQueryInput): Promise<IncidentListView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const page = query.page ?? 1
      const limit = query.limit ?? 20
      const offset = (page - 1) * limit

      const filtros = {
        status: query.status,
        priority: query.priority,
        category: query.category,
        q: query.q,
      }

      const rows = await repo.listIncidents(tx, communityId, { ...filtros, limit, offset })

      let total = 0
      const primera = rows[0]

      if (primera) {
        total = toTotal(primera.total_count)
      } else if (offset > 0) {
        // La pagina estaba mas alla del final. Una fila de la primera pagina es
        // suficiente para traer el total, y si tampoco hay fila es que no hay nada que
        // paginar: total 0 es la respuesta correcta.
        const muestra = await repo.listIncidents(tx, communityId, { ...filtros, limit: 1, offset: 0 })
        const primeraMuestra = muestra[0]
        total = primeraMuestra ? toTotal(primeraMuestra.total_count) : 0
      }

      return {
        items: rows.map(toIncidentView),
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

/**
 * Una incidencia concreta.
 *
 * El `requireIncident()` de la ruta ya ha resuelto la comunidad y ha puesto 404 si no
 * es visible, asi que llegar aqui casi siempre significa que existe. El 404 de este
 * `if` es la segunda red: la funcion vuelve a filtrar por visibilidad y si entre el
 * guard y esta llamada la incidencia se borrara, aqui sale el 404 correcto en vez de
 * un objeto a medias.
 *
 * Y no es una carrera teorica: dos peticiones concurrentes, un `DELETE` por un ADMIN y
 * un `GET` de un vecino, se ejecutan en el mismo orden que el motor quiera.
 */
export async function getIncident(userId: string, communityId: string, incidentId: string): Promise<IncidentView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const row = await repo.findIncident(tx, incidentId)

      if (!row) {
        throw notFound('Esa incidencia no existe.')
      }

      return toIncidentView(row)
    }),
  )
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

/**
 * Crear una incidencia.
 *
 * Cualquier miembro activo puede abrirla. Lo que NO puede es abrirla en nombre de
 * otro: `reporterId` no esta en el esquema y el reporter lo pone
 * `app_current_user_id()` dentro de la funcion (I-5).
 *
 * `needs_review` no se manda ni se devuelve como entrada. Lo decide la funcion, y lo
 * decide BIEN: depende de si quien escala es un vecino, y eso el backend no lo sabe
 * sin ir a mirar la membresia. Si se calculara aqui haria falta una segunda consulta
 * y un segundo sitio donde equivocarse.
 *
 * Se relee la incidencia creada con `app_get_incident()` y se devuelve esa, en vez de
 * inventar la respuesta. La funcion devuelve `void` justamente para no poder devolver
 * medio estado: leer despues cuesta una consulta y elimina la clase de fallos en la
 * que la respuesta dice una cosa y la tabla dice otra.
 */
export async function createIncident(
  userId: string,
  communityId: string,
  input: CreateIncidentInput,
): Promise<IncidentView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const id = await repo.createIncident(tx, communityId, input)

      const row = await repo.findIncident(tx, id)

      if (!row) {
        // La funcion es SECURITY DEFINER y acaba de insertar la fila; si no se ve,
        // algo se ha roto por debajo. Un 404 seria mentira: si que existe.
        throw new Error('La incidencia se creó pero no se puede leer.')
      }

      return toIncidentView(row)
    }),
  )
}

/**
 * Editar el contenido, y opcionalmente la prioridad y la asignacion.
 *
 * LA EXCEPCION DE ESTE ARCHIVO, y hay que entenderla antes de cambiar nada.
 *
 * El `PUT` puede traer `priority` o `assignedToId`, y los dos son de ADMIN (I-4, I-8).
 * La regla del proyecto es que el rol se comprueba con un guard, no comparando en el
 * codigo, y con razon: un guard que mira `req.community.role` contra el estado real es
 * un permiso de verdad. Aqui no se puede usar, porque no hay una ruta por rol: las ocho
 * rutas de incidencia comparten el mismo `requireIncident()`, y solo tres necesitan
 * ADMIN.
 *
 * Se podria montar un guard `requireIncidentRole('ADMIN')` y usarlo en esas tres. Y es
 * lo que haria el resto del proyecto.
 *
 * PERO el permiso de verdad no lo da el guard: lo dan las funciones de SQL, que ya
 * comprueban el ADMIN DENTRO de la transaccion contra la fila. Si un vecino llegara
 * aqui por el camino que sea, `app_set_incident_priority()` le devolveria 42501 y
 * seria un 403 de verdad. El `if` de este metodo es la PRIMERA capa, no la unica, y
 * existe para que el mensaje sea el bueno ("no puedes cambiar la prioridad") y para no
 * hacer escribir el contenido de una incidencia antes de fallar por la prioridad.
 *
 * Consecuencia de que sea solo una capa: si alguien quitara el `if` de aqui, el
 *endpoint seguiria siendo seguro, con un mensaje peor y un UPDATE de contenido de mas.
 * Al reves —si se confiara en el `if` y se quitara el `if` de la funcion— seria un
 * agujero. Por eso el orden correcto es: el `if` optimiza, la funcion manda.
 *
 * Las tres llamadas (contenido, prioridad, asignacion) van en la MISMA transaccion
 * porque hay un solo `withContext`. O se aplican las tres o no se aplica ninguna, que
 * es lo que evita el estado intermedio de "el ADMIN subio la prioridad pero no cambio
 * el texto".
 *
 * El orden importa en un caso concreto: primero el contenido, despues la prioridad, y
 * al reponer la prioridad se limpia `needs_review`. Si fuera al reves, un texto
 * invalido (un titulo de tres letras) dejaria la prioridad cambiada sin contenido
 * actualizado, y el 23514 del CHECK abortaria la transaccion entera igualmente— pero
 * el orden hace que el fallo que ve el usuario sea el del contenido y no el del
 * permiso.
 */
export async function updateIncident(
  userId: string,
  communityId: string,
  incidentId: string,
  role: string,
  input: UpdateIncidentInput,
): Promise<IncidentView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const tocaPrioridad = input.priority !== undefined
      const tocaAsignacion = input.assignedToId !== undefined

      if ((tocaPrioridad || tocaAsignacion) && role !== 'ADMIN') {
        throw forbidden('Tu rol en esta comunidad no permite esta acción.')
      }

      await repo.updateContent(tx, incidentId, {
        title: input.title,
        description: input.description,
        category: input.category,
        location: input.location,
      })

      if (tocaPrioridad && input.priority !== undefined) {
        await repo.setPriority(tx, incidentId, input.priority)
      }

      if (tocaAsignacion) {
        await repo.assign(tx, incidentId, input.assignedToId ?? null)
      }

      const row = await repo.findIncident(tx, incidentId)

      if (!row) {
        throw notFound('Esa incidencia no existe.')
      }

      return toIncidentView(row)
    }),
  )
}

/**
 * Transicionar el estado.
 *
 * Todo el decide aqui esta dentro de `app_transition_incident()` (el grafo de 5.6 y el
 * guard de actor). Este metodo no mira el estado actual ni el rol, y no es por
 * descuido: si el grafo se comprobara en TypeScript habria que leer la fila, decidir
 * en memoria y escribir despues, con una transaccion abierta de por medio. Dos
 * peticiones simultaneas a `IN_PROGRESS` pasarian las dos, y las dos devolverian 200.
 *
 * El `UPDATE` condicional de la funcion (`where status = v_from`) es lo que resuelve
 * eso en el motor, y el 409 del segundo llega con el sentinel correcto.
 *
 * Y el 403 de un `PRESIDENT` (D-4) sale de la funcion, no de aqui: el rol se comprueba
 * contra la fila de membresia dentro de la transaccion, no contra el token de sesion.
 */
export async function transitionIncident(
  userId: string,
  communityId: string,
  incidentId: string,
  input: TransitionIncidentInput,
): Promise<IncidentView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      await repo.transition(tx, incidentId, input.status)

      const row = await repo.findIncident(tx, incidentId)

      if (!row) {
        throw notFound('Esa incidencia no existe.')
      }

      return toIncidentView(row)
    }),
  )
}

/**
 * Borrado lógico (I-6). Solo ADMIN.
 *
 * Devuelve `void` y la ruta responde 204, no la incidencia con `deleted_at` puesto:
 * una vez borrada, para el cliente no existe (su GET da 404), y devolverla seria
 * contradiciendo eso. El `requireIncident()` de la ruta ya ha puesto 404 si no se ve, y
 * la funcion lo vuelve a comprobar: el segundo borrado es un 404, no un 200 idempotente.
 *
 * Idempotente en el sentido contrario al habitual: borrar dos veces NO es un success,
 * es un 404. Un 204 repetido diria que el recurso se puede borrar sin limite, y lo que
 * se puede borrar es una vez.
 */
export async function deleteIncident(userId: string, communityId: string, incidentId: string): Promise<void> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      await repo.softDelete(tx, incidentId)
    }),
  )
}

// ---------------------------------------------------------------------------
// Comentarios
// ---------------------------------------------------------------------------

/**
 * Comentarios de una incidencia.
 *
 * Salen todos, en orden cronologico, y no se paginan. El `incident_comments_incident_idx`
 * es `(incident_id, created_at)`, asi que el orden es el del indice y no hay sort
 * encima.
 *
 * La visibilidad la pone `app_can_see_incident()` dentro de la funcion, y por eso una
 * incidencia que no se puede ver devuelve una lista VACIA y no un 404. No es un
 * descuido: el `requireIncident()` de la ruta ya ha devuelto 404 antes de llegar aqui,
 * asi que el 0 filas solo es alcanzable por una carrera con un borrado concurrente. Y un
 * array vacio es la respuesta correcta para un GET de una lista.
 */
export async function listComments(userId: string, communityId: string, incidentId: string): Promise<CommentView[]> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const rows = await repo.listComments(tx, incidentId)
      return rows.map(toCommentView)
    }),
  )
}

/**
 * Comentar una incidencia.
 *
 * El autor es el actor. `authorId` no esta en el esquema y la politica
 * `comments_insert_author` comprueba `author_id = app_current_user_id()`, asi que
 * mandarlo seria un 400 de `.strict()` en vez de un comentario con otro autor.
 *
 * A diferencia de las seis funciones de escritura de incidencias, esta va por el
 * cliente de Prisma y no por una funcion SECURITY DEFINER. Es la excepcion consciente
 * de la seccion 6 de la spec: un comentario no tiene estado, ni prioridad, ni
 * transiciones, asi que no hay ninguna regla de dominio que justifique una capa. Lo
 * que si hay es una regla de ALCANCE, y esa la pone la politica de SELECT y de INSERT
 * sobre `incident_comments`, que es lo que impide comentar en una incidencia ajena.
 *
 * El `authorName` de la respuesta sale de releer la lista: si se devolviera el `id` sin
 * mas, el cliente tendria que hacer una segunda peticion para pintar el nombre del
 * autor de su propio comentario, que es el nombre que ya conoce.
 */
export async function createComment(
  userId: string,
  communityId: string,
  incidentId: string,
  input: CreateCommentInput,
): Promise<CommentView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const id = await repo.createComment(tx, incidentId, userId, input.body)

      const rows = await repo.listComments(tx, incidentId)
      const row = rows.find((c) => c.id === id)

      if (!row) {
        // Acaba de insertarse y la propia politica deja leerlo. Si no aparece, algo se
        // ha roto por debajo; un 404 seria mentira porque si que existe.
        throw new Error('El comentario se creó pero no se puede leer.')
      }

      return toCommentView(row)
    }),
  )
}
