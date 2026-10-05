// ---------------------------------------------------------------------------
// Validacion de entrada de incidencias (zod).
//
// Mismas reglas que en los modulos anteriores: validacion en el borde, `.strict()`
// en todos los esquemas y mensajes en castellano. Lo propio de este bloque:
//
//   - Los ENUM se listan aqui y no se dejan pasar como texto libre: un `$queryRaw`
//     con un `${valor}` sin castear deja que el texto llegue al servidor, y ahi un
//     `::incident_priority` con basura revienta con 22P02. Validarlo antes convierte
//     eso en un 400 que nombra el campo.
//   - Los limites de longitud son los MISMOS que los CHECK de 01_schema.sql y de
//     02e_incidents.sql, no otros. Duplicarlos es inevitable (el backend no puede
//     leer las constraints), pero si los dos sitios dijeran numeros distintos, el que
//     fallara primero seria el que se comprueba antes de dar el error, y ese es el
//     500. Los numeros de aqui son una copia comentada de los de alla.
//   - `page` y `limit` se validan como enteros. Aceptarlos como texto y convertirlos
//     con `Number` daria `page=abc` -> NaN -> un `offset` NaN que Postgres rechaza
//     con un error que no parece de validacion.
//
// El `title` de 5 a 200 y la `description` de 10 a 4000 NO son invento de la
// validacion: son `incidents_title_length` y `incidents_description_length`.
// ---------------------------------------------------------------------------

import { z } from 'zod'

/** Los cuatro estados de `incident_status` (01_schema.sql). */
const ESTADOS = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED'] as const

/** Las cuatro prioridades de `incident_priority`. */
const PRIORIDADES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const

/** Las siete categorias de `incident_category`. */
const CATEGORIAS = [
  'ELEVATOR',
  'ELECTRICITY',
  'PLUMBING',
  'CLEANING',
  'SECURITY',
  'HEATING',
  'OTHER',
] as const

/**
 * Mismo criterio que `members/validators.ts` (C-9).
 *
 * Un id que no tiene forma de UUID es una peticion mal formada, no una peticion sin
 * permiso: 400 y no 403. Y se comprueba antes de abrir transaccion, porque un
 * `::uuid` sobre texto invalido revienta con 22P02.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * El titulo. 5-200, igual que `incidents_title_length`.
 *
 * El minimo de 5 no es arbitrario, pero tampoco es un capricho de estilo: es el
 * CHECK. Con 4 caracteres el backend lo acepta, la funcion lo acepta y el INSERT
 * revienta con 23514, que si no se tradujera bien llegaria como un 500.
 */
const title = z
  .string()
  .trim()
  .min(5, 'El título debe tener al menos 5 caracteres.')
  .max(200, 'El título no puede pasar de 200 caracteres.')

/** La descripcion. 10-4000, igual que `incidents_description_length`. */
const description = z
  .string()
  .trim()
  .min(10, 'La descripción debe tener al menos 10 caracteres.')
  .max(4000, 'La descripción no puede pasar de 4000 caracteres.')

/**
 * La ubicacion.
 *
 * Opcional, y `.nullish()` a proposito: el PUT la usa para BORRAR la ubicacion
 * (`location: null`), y sin `null` en el esquema un borrado de ubicacion seria
 * indistinguible de un campo ausente. Se limita a 200 porque en la tabla es un
 * `text` sin CHECK y sin limite seria un `text` gigante en una columna que sale en
 * todas las listas.
 *
 * El `.transform` de abajo es lo que hace que `''` y `null` sean lo mismo antes de
 * llegar al SQL, para que `app_update_incident_content` pueda usar el mismo
 * `nullif(btrim(p_location), '')` en los dos casos.
 */
const location = z
  .string()
  .trim()
  .max(200, 'La ubicación no puede pasar de 200 caracteres.')
  .nullish()
  .transform((value) => (value ? value : null))

/**
 * Alta de una incidencia.
 *
 * `reporterId` NO se acepta (I-5), y con `.strict()` mandarlo es un 400 que lo
 * dice, en vez de un 201 en el que el campo se ignora en silencio. El reporter lo
 * pone `app_current_user_id()` dentro de la funcion: es la unica fuente posible, y
 * que el backend no tenga el campo hace imposible que se equivoque al usarlo.
 *
 * `priority` es opcional con `MEDIUM` por defecto, igual que la columna. `category`
 * es opcional con `OTHER` por el mismo motivo. `location` es opcional de verdad.
 */
export const createIncidentSchema = z
  .object({
    title,
    description,
    category: z.enum(CATEGORIAS).optional(),
    priority: z.enum(PRIORIDADES).optional(),
    location,
  })
  .strict()

/**
 * PUT del contenido, con ajuste opcional de prioridad y asignacion.
 *
 * `priority` y `assignedToId` son opcionales y significan cosas distintas: el
 * primero lo cambia el ADMIN, el segundo tambien. El permiso NO se comprueba aqui:
 * el rol no viaja en el cuerpo, y una comprobacion de rol sobre un campo del cuerpo
 * seria una regla que el cliente puede esquivar cambiando el cuerpo. Va en el
 * servicio, con el rol que resuelve el middleware.
 *
 * `title`, `description` y `category` son obligatorios porque el PUT es de
 * REEMPLAZO COMPLETO del contenido: un PUT parcial que dejara campos sin tocar
 * significaria que el cliente tiene que saber de antemano el estado anterior, que
 * es lo que hacen las actualizaciones optimistas que aqui no interesan. Ser
 * obligatorios en el objeto es suficiente para que no falten; no hace falta un
 * `.refine()` que lo compruebe otra vez.
 *
 * `status` NO esta en el esquema, y no hay ninguna forma de mandarlo: I-12 dice que
 * el estado se cambia por su propia ruta, y con `.strict()` mandarlo aqui da un 400
 * que lo explica en vez de un 200 que lo ignora.
 *
 * `assignedToId` admite `null` a proposito: desasignar es una operacion real (el
 * proveedor dejo de estar disponible) y sin `null` no tendria forma de expresarse.
 */
export const updateIncidentSchema = z
  .object({
    title,
    description,
    category: z.enum(CATEGORIAS),
    location,
    priority: z.enum(PRIORIDADES).optional(),
    assignedToId: z.string().regex(UUID_RE, 'assignedToId debe ser un UUID.').nullish(),
  })
  .strict()

/**
 * Cambio de estado. Un solo campo.
 *
 * `.strict()` mas un solo campo es lo que hace que un PATCH con `{ status, priority }`
 * sea un 400 explicito y no una transicion que se cuela con un campo de mas.
 */
export const transitionIncidentSchema = z
  .object({
    status: z.enum(ESTADOS),
  })
  .strict()

/**
 * Comentario. Un solo campo, 1-2000 (I-7, `incident_comments_body_length`).
 *
 * No hay `PUT` ni `DELETE` de comentarios en este bloque: un comentario no se
 * edita ni se borra desde la API, y por eso no hay esquemas para ellos. Un `PATCH`
 * sobre un comentario daria 404, no 400, porque la ruta no existe.
 */
export const createCommentSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, 'El comentario no puede estar vacío.')
      .max(2000, 'El comentario no puede pasar de 2000 caracteres.'),
  })
  .strict()

/**
 * Filtros del listado.
 *
 * Se validan aqui y no se dejan pasar como texto al SQL por dos motivos. El primero
 * es el `::incident_status`: sin el cast, `status=inventado` llegaria como texto y
 * Postgres lo rechazaria con 22P02, que es un 500 si nadie lo traduce. El segundo es
 * el `offset`, que tiene que ser un entero de verdad.
 *
 * `q` se limita a 100 porque va dentro de un `ilike '%q%'` sobre un indice trigram: no
 * es una inyeccion (es un parametro ligado), pero un texto de 50 KB si lo puede
 * hacer lento.
 *
 * `page` y no `offset`: la API expone `meta.page`, que es lo que consume el cliente,
 * y convertirlo aqui evita que el servicio tenga que restar uno en un solo sitio.
 */
export const listQuerySchema = z
  .object({
    status: z.enum(ESTADOS).optional(),
    priority: z.enum(PRIORIDADES).optional(),
    category: z.enum(CATEGORIAS).optional(),
    q: z.string().trim().min(1).max(100, 'La búsqueda no puede pasar de 100 caracteres.').optional(),
    page: z.coerce.number().int('La página debe ser un número entero.').min(1, 'La página empieza en 1.').optional(),
    limit: z.coerce.number().int('El límite debe ser un número entero.').min(1).max(100, 'El límite máximo es 100.').optional(),
  })
  .strict()

/**
 * Un UUID de ruta.
 *
 * Se exporta como esquema para que el controller lo valide con el mismo `parse` que
 * usa para los cuerpos, en vez de un segundo camino de validacion.
 */
export const uuidSchema = z.string().regex(UUID_RE, 'Debe ser un UUID.')

/** Los valores admitidos, para los mensajes de error de los tests. */
export const ESTADOS_VALIDOS = ESTADOS
export const PRIORIDADES_VALIDOS = PRIORIDADES
export const CATEGORIAS_VALIDAS = CATEGORIAS

export type CreateIncidentInput = z.infer<typeof createIncidentSchema>
export type UpdateIncidentInput = z.infer<typeof updateIncidentSchema>
export type TransitionIncidentInput = z.infer<typeof transitionIncidentSchema>
export type CreateCommentInput = z.infer<typeof createCommentSchema>
export type ListQueryInput = z.infer<typeof listQuerySchema>