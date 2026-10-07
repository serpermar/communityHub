// ---------------------------------------------------------------------------
// Validacion de entrada de avisos (zod).
//
// Mismas reglas que en los modulos anteriores: validacion en el borde, `.strict()`
// en todos los esquemas y mensajes en castellano. Lo propio de este bloque:
//
//   - Los ENUM (`type`, `priority`) se listan aqui y no se dejan pasar como texto
//     libre: un `$queryRaw` con un `${valor}` sin castear deja que el texto llegue
//     al servidor, y ahi un `::announcement_type` con basura revienta con 22P02.
//     Validarlo antes convierte eso en un 400 que nombra el campo.
//   - Los limites de longitud son los MISMOS que los CHECK que 02h_announcements.sql
//     añade sobre la tabla (`announcements_title_length`, `announcements_body_length`),
//     no otros. Duplicarlos es inevitable (el backend no puede leer las
//     constraints), pero si los dos sitios dijeran numeros distintos, el que
//     fallara primero seria el que se comprueba antes de dar el error. Los numeros
//     de aqui son una copia comentada de los de alla.
//   - `expiresAt > publishAt` se comprueba aqui con fechas de verdad y no por
//     texto: dos cadenas ISO con offsets distintos ("+02:00" y "Z") se
//     compararian mal. En SQL lo garantiza el CHECK announcements_dates_valid
//     (23514 -> 400); aqui el mismo resultado llega como 400 de zod.
//
// Los campos que NO estan en ningun esquema lo estan a proposito (AN-9 y AN-6):
// `authorId` y `communityId` no se aceptan en el cuerpo de nada, y en el PUT
// `id`, `createdAt` o `updatedAt` dan un 400 explicito por `.strict()`.
// ---------------------------------------------------------------------------

import { z } from 'zod'

/** Los cuatro tipos de `announcement_type` (01_schema.sql). */
const TIPOS = ['GENERAL', 'URGENT', 'MAINTENANCE', 'MEETING'] as const

/** Las tres prioridades de `announcement_priority`. */
const PRIORIDADES = ['LOW', 'MEDIUM', 'HIGH'] as const

/**
 * Mismo criterio que `members/validators.ts` (C-9).
 *
 * Un id que no tiene forma de UUID es una peticion mal formada, no una peticion
 * sin permiso: 400 y no 403. Y se comprueba antes de abrir transaccion, porque
 * un `::uuid` sobre texto invalido revienta con 22P02.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Instante ISO 8601 estricto, con `Z` o con offset explicito.
 *
 * `offset: true` a proposito: un cliente de Valencia puede mandar
 * `2026-10-06T10:00:00+02:00` y eso es un instante valido. Lo que NO se acepta
 * es un texto que no sea un instante, porque llegaria al `::timestamptz` como
 * 22P02.
 */
const instante = z.iso.datetime({ offset: true })

/**
 * El titulo. 3-120, igual que `announcements_title_length`.
 *
 * 120 es de tablón —cabe en un aviso de móvil— y el minimo de 3 no es
 * arbitrario: es el CHECK. Con 2 caracteres el backend lo aceptaria, la funcion
 * lo aceptaria y el INSERT revienta con 23514.
 */
const titulo = z
  .string()
  .trim()
  .min(3, 'El título debe tener al menos 3 caracteres.')
  .max(120, 'El título no puede pasar de 120 caracteres.')

/**
 * El cuerpo. 1-5000, igual que `announcements_body_length`.
 *
 * 5000 admite el comunicado entero sin adjunto; los adjuntos son de la spec 08.
 */
const cuerpo = z
  .string()
  .trim()
  .min(1, 'El cuerpo no puede estar vacío.')
  .max(5000, 'El cuerpo no puede pasar de 5000 caracteres.')

/**
 * La ventana (AN-4) comprobada en la capa de entrada.
 *
 * Solo cuando los DOS instantes estan presentes: en el POST `publishAt` es
 * opcional (el default lo pone la columna con `now()`), y comparar contra nada
 * seria inventar una fecha. En el PUT los dos van siempre, asi que la
 * comprobacion siempre se hace. En SQL la misma regla es el CHECK
 * `announcements_dates_valid`, y su violacion llegaria como 23514 -> 400.
 *
 * Devuelve el mensaje en vez de agregarlo, para que el `ctx.addIssue` viva en
 * el `.superRefine` de cada esquema con su tipo inferido (mismo estilo que
 * `reservations/validators.ts`).
 */
function errorDeVentana(publishAt?: string, expiresAt?: string | null): string | null {
  if (!publishAt || !expiresAt) return null

  // Comparacion por instante y no por cadena, por el mismo motivo de arriba:
  // dos ISO con offsets distintos se ordenarian mal por texto.
  if (Date.parse(expiresAt) <= Date.parse(publishAt)) {
    return 'La caducidad debe ser posterior a la publicación.'
  }

  return null
}

/**
 * Alta de un aviso (POST).
 *
 * Todo lo demas es opcional y usa el default de la columna dentro de la
 * funcion: `GENERAL`, `MEDIUM`, `false`, `now()` y `null` (no caduca). Que el
 * backend NO ponga esos defaults y se los deje a `app_create_announcement()`
 * es deliberado: asi "no lo mandaste" y "lo mandaste igual que el default"
 * acaban en el mismo sitio, y solo hay un sitio donde estan escritos.
 *
 * `authorId` y `communityId` NO se aceptan (AN-9): el autor lo escribe la
 * funcion con `app_current_user_id()` y la comunidad la decide la URL. Con
 * `.strict()`, mandarlos es un 400 que lo dice.
 */
export const createAnnouncementSchema = z
  .object({
    title: titulo,
    body: cuerpo,
    type: z.enum(TIPOS).optional(),
    priority: z.enum(PRIORIDADES).optional(),
    isPinned: z.boolean().optional(),
    publishAt: instante.optional(),
    expiresAt: instante.nullable().optional(),
  })
  .strict()
  .superRefine((datos, ctx) => {
    const mensaje = errorDeVentana(datos.publishAt, datos.expiresAt)
    if (mensaje) {
      ctx.addIssue({ code: 'custom', message: mensaje, path: ['expiresAt'] })
    }
  })

/**
 * Edicion de un aviso (PUT, AN-6): reemplazo completo, los ocho campos
 * obligatorios. `expiresAt` admite `null` explicito, que significa "no caduca
 * nunca": sin `null` en el esquema, un borrado de caducidad seria
 * indistinguible de un campo ausente y el PUT no podria deshacer un aviso
 * caducado.
 *
 * No hay PATCH, y no lo habra: la arquitectura dice PUT. Un PUT parcial que
 * dejara `expiresAt` sin tocar significaria que el cliente tiene que saber
 * cual era el estado anterior para no romper la ventana.
 */
export const updateAnnouncementSchema = z
  .object({
    title: titulo,
    body: cuerpo,
    type: z.enum(TIPOS),
    priority: z.enum(PRIORIDADES),
    isPinned: z.boolean(),
    publishAt: instante,
    expiresAt: instante.nullable(),
  })
  .strict()
  .superRefine((datos, ctx) => {
    const mensaje = errorDeVentana(datos.publishAt, datos.expiresAt)
    if (mensaje) {
      ctx.addIssue({ code: 'custom', message: mensaje, path: ['expiresAt'] })
    }
  })

/**
 * Filtros del listado.
 *
 * Se validan aqui y no se dejan pasar como texto al SQL por dos motivos. El
 * primero es el `::announcement_type`: sin el cast, `type=inventado` llegaria
 * como texto y Postgres lo rechazaria con 22P02, que es un 500 si nadie lo
 * traduce. El segundo es el `offset`, que tiene que ser un entero de verdad.
 *
 * `q` se limita a 100 porque va dentro de un `ilike '%q%'`: no es una
 * inyeccion (es un parametro ligado), pero un texto de 50 KB si lo puede
 * hacer lento.
 *
 * `page` y no `offset`: la API expone `meta.page`, que es lo que consume el
 * cliente, y convertirlo aqui evita que el servicio tenga que restar uno en un
 * solo sitio.
 *
 * Parametros desconocidos (`?pinned=true`) son 400 por `.strict()`: los
 * filtros son los de la spec §7.3 y ninguno mas.
 */
export const listQuerySchema = z
  .object({
    type: z.enum(TIPOS).optional(),
    q: z.string().trim().min(1).max(100, 'La búsqueda no puede pasar de 100 caracteres.').optional(),
    page: z.coerce.number().int('La página debe ser un número entero.').min(1, 'La página empieza en 1.').optional(),
    limit: z.coerce.number().int('El límite debe ser un número entero.').min(1).max(100, 'El límite máximo es 100.').optional(),
  })
  .strict()

/** Tipos de listado que acepta la API (para tests y para el controller). */
export type AnnouncementType = (typeof TIPOS)[number]

/** Los valores admitidos, para los mensajes de error de los tests. */
export const TIPOS_VALIDOS = TIPOS
export const PRIORIDADES_VALIDAS = PRIORIDADES

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>
export type ListQueryInput = z.infer<typeof listQuerySchema>

/**
 * Un UUID de ruta.
 *
 * Se exporta como esquema para que el controller lo valide con el mismo `parse`
 * que usa para los cuerpos, en vez de un segundo camino de validacion.
 */
export const uuidSchema = z.string().regex(UUID_RE, 'Debe ser un UUID.')
