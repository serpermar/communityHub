// ---------------------------------------------------------------------------
// Validacion de entrada de votaciones (zod).
//
// Mismas reglas que en los modulos anteriores: validacion en el borde,
// `.strict()` en todos los esquemas y mensajes en castellano. Lo propio de este
// bloque:
//
//   - Los TRES enums (`type`, `status`, `resultVisibility`) se listan, no se
//     dejan pasar como texto libre: sin la lista, `type=inventado` llegaria al
//     `::vote_type` de Postgres y reventaria con 22P02, que sin traduccion es un
//     500.
//   - `options` es la lista de opciones REALES (2-20 cadenas). V-10 hace que la
//     abstencion la genere el sistema como una opcion `is_abstention`; el cliente
//     NO la manda, y por eso el rango empieza en 2 y no en 1. Los duplicados NO
//     se filtran aqui: los detecta `app_set_vote_options()` con
//     `vote_option_duplicate`, para que el error lleve el codigo de contrato
//     VOTE_OPTION_DUPLICATE y no el generico VALIDATION_ERROR.
//   - `startsAt`/`endsAt` son ISO 8601 estricto y `ends > starts` se compara por
//     instante y no por texto, como en reservas (dos ISO con offsets distintos se
//     ordenarian mal como cadenas).
//   - El PATCH (V-7) es parcial y SIN `.transform()` en los opcionales: en zod 4
//     un campo con transform aparece en la salida aunque no venga en el cuerpo, y
//     un PATCH que solo cambia el titulo borraria la descripcion. Sin transform,
//     una clave ausente simplemente no existe, y el SQL distingue "no lo has
//     enviado" de "lo has mandado" con `p_patch ? 'clave'`.
//   - `quorumPercent` es obligatorio si `type='QUORUM'` y prohibido si
//     `SINGLE` (V-9). La funcion lo repite sobre el valor YA fusionado del PATCH,
//     que es donde el zod no puede decidir solo.
// ---------------------------------------------------------------------------

import { z } from 'zod'

/** Los dos tipos de `vote_type` (01_schema.sql §4.14). */
const TIPOS = ['SINGLE', 'QUORUM'] as const

/** Los tres estados de `vote_status`. */
const ESTADOS = ['DRAFT', 'OPEN', 'CLOSED'] as const

/** Los tres modos de `vote_result_visibility` (V-12). */
const VISIBILIDADES = ['AFTER_CLOSE', 'LIVE', 'ADMIN_ONLY'] as const

/** Mismo criterio que `members/validators.ts` (C-9). */
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
 * Igual que `optionalText` de comunidades pero SIN `.transform()`, y solo para el
 * PATCH: ver la cabecera. Convertir la cadena vacia en NULL lo hace el SQL con
 * `nullif(btrim(...), '')`.
 */
const textoEditable = (max: number, label: string) => z.string().trim().max(max, `${label} es demasiado largo.`).nullish()

/** Limites de V-10: 2 opciones reales como minimo, 20 como maximo. */
const opciones = z
  .array(z.string().trim().min(1, 'Las opciones no pueden estar vacías.').max(120, 'Cada opción admite hasta 120 caracteres.'))
  .min(2, 'Una votación necesita al menos dos opciones.')
  .max(20, 'Una votación no puede tener más de veinte opciones.')

/**
 * Alta de una votacion.
 *
 * `status`, `createdBy` y `communityId` NO estan en el esquema: la primera nace
 * DRAFT dentro de la funcion (V-6), el segundo lo pone la sesion y la tercera
 * viene en la URL. Con `.strict()` mandarlos es un 400 que lo dice.
 */
export const createVoteSchema = z
  .object({
    title: z.string().trim().min(1, 'El título es obligatorio.').max(120, 'El título no puede pasar de 120 caracteres.'),
    question: z
      .string()
      .trim()
      .min(1, 'La pregunta es obligatoria.')
      .max(200, 'La pregunta no puede pasar de 200 caracteres.'),
    description: textoEditable(1000, 'La descripción'),
    type: z.enum(TIPOS, { error: 'El tipo debe ser SINGLE o QUORUM.' }).optional(),
    startsAt: instante,
    endsAt: instante,
    allowAbstention: z.boolean().optional(),
    quorumPercent: z
      .number()
      .int('El quórum debe ser un número entero.')
      .min(1, 'El quórum debe estar entre 1 y 100.')
      .max(100, 'El quórum debe estar entre 1 y 100.')
      .nullish(),
    resultVisibility: z.enum(VISIBILIDADES, { error: 'La visibilidad debe ser AFTER_CLOSE, LIVE o ADMIN_ONLY.' }).optional(),
    options: opciones,
  })
  .strict()
  .superRefine((datos, ctx) => {
    if (Date.parse(datos.startsAt) >= Date.parse(datos.endsAt)) {
      ctx.addIssue({
        code: 'custom',
        message: 'El cierre debe ser posterior al inicio.',
        path: ['endsAt'],
      })
    }

    // V-9: QUORUM exige quorum, SINGLE lo prohibe. Aqui `type` ausente cuenta
    // como SINGLE porque es el default de la tabla.
    const esQuorum = datos.type === 'QUORUM'

    if (esQuorum && datos.quorumPercent == null) {
      ctx.addIssue({
        code: 'custom',
        message: 'Una votación por quórum necesita el porcentaje de quórum.',
        path: ['quorumPercent'],
      })
    }

    if (!esQuorum && datos.quorumPercent != null) {
      ctx.addIssue({
        code: 'custom',
        message: 'El porcentaje de quórum solo aplica a las votaciones de tipo QUORUM.',
        path: ['quorumPercent'],
      })
    }
  })

/**
 * PATCH parcial, solo sobre un DRAFT (V-7).
 *
 * Sin `.transform()` en los opcionales (ver cabecera) y con al menos un campo:
 * un PATCH vacio no es un error de un campo, es una peticion que no queria hacer
 * nada.
 *
 * La coherencia `QUORUM`/`quorumPercent` y la comparacion de fechas solo se
 * comprueban cuando el PATCH trae las dos piezas que hacen falta; si solo manda
 * una, el valor fusionado lo valida `app_update_vote()`.
 */
export const updateVoteSchema = z
  .object({
    title: z.string().trim().min(1, 'El título es obligatorio.').max(120, 'El título no puede pasar de 120 caracteres.').optional(),
    question: z
      .string()
      .trim()
      .min(1, 'La pregunta es obligatoria.')
      .max(200, 'La pregunta no puede pasar de 200 caracteres.')
      .optional(),
    description: textoEditable(1000, 'La descripción'),
    type: z.enum(TIPOS, { error: 'El tipo debe ser SINGLE o QUORUM.' }).optional(),
    startsAt: instante.optional(),
    endsAt: instante.optional(),
    allowAbstention: z.boolean().optional(),
    quorumPercent: z
      .number()
      .int('El quórum debe ser un número entero.')
      .min(1, 'El quórum debe estar entre 1 y 100.')
      .max(100, 'El quórum debe estar entre 1 y 100.')
      .nullish(),
    resultVisibility: z.enum(VISIBILIDADES, { error: 'La visibilidad debe ser AFTER_CLOSE, LIVE o ADMIN_ONLY.' }).optional(),
    options: opciones.optional(),
  })
  .strict()
  .superRefine((datos, ctx) => {
    if (Object.keys(datos).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'No hay nada que actualizar.', path: [] })
      return
    }

    if (datos.startsAt !== undefined && datos.endsAt !== undefined && Date.parse(datos.startsAt) >= Date.parse(datos.endsAt)) {
      ctx.addIssue({ code: 'custom', message: 'El cierre debe ser posterior al inicio.', path: ['endsAt'] })
    }

    if (datos.type === 'QUORUM' && datos.quorumPercent === null) {
      ctx.addIssue({
        code: 'custom',
        message: 'Una votación por quórum necesita el porcentaje de quórum.',
        path: ['quorumPercent'],
      })
    }

    if (datos.type === 'SINGLE' && datos.quorumPercent != null) {
      ctx.addIssue({
        code: 'custom',
        message: 'El porcentaje de quórum solo aplica a las votaciones de tipo QUORUM.',
        path: ['quorumPercent'],
      })
    }
  })

/**
 * Filtros del listado de votaciones de una comunidad.
 *
 * `status` filtra por ESTADO EFECTIVO (V-6): `?status=CLOSED` incluye las
 * abiertas ya vencidas aunque su fila siga diciendo OPEN.
 */
export const votesQuerySchema = z
  .object({
    status: z.enum(ESTADOS, { error: 'El estado debe ser DRAFT, OPEN o CLOSED.' }).optional(),
    page: z.coerce.number().int('La página debe ser un número entero.').min(1, 'La página empieza en 1.').optional(),
    limit: z.coerce.number().int('El límite debe ser un número entero.').min(1).max(100, 'El límite máximo es 100.').optional(),
  })
  .strict()

/** El cuerpo de `POST /votes/:id/responses`: un unico `optionId` (V-11). */
export const castVoteSchema = z
  .object({
    optionId: z.string().regex(UUID_RE, 'optionId debe ser un UUID.'),
  })
  .strict()

/**
 * Cuerpo vacio para `publish` y `close` (spec 10 §7.3): no llevan cuerpo.
 *
 * `.strict()` sobre un objeto vacio es lo que hace que un `{status}` sea un 400
 * explicito en vez de una operacion que ignora el cuerpo. El controller lo
 * normaliza a `{}` cuando el cliente hace `fetch` sin body.
 */
export const emptyBodySchema = z.object({}).strict()

/**
 * Un UUID de ruta.
 *
 * Se exporta como esquema para que el controller lo valide con el mismo `parse`
 * que usa para los cuerpos, en vez de un segundo camino de validacion.
 */
export const uuidSchema = z.string().regex(UUID_RE, 'Debe ser un UUID.')

/** Los valores admitidos, para los mensajes de error de los tests. */
export const TIPOS_VALIDOS = TIPOS
export const ESTADOS_VALIDOS = ESTADOS
export const VISIBILIDADES_VALIDAS = VISIBILIDADES

export type CreateVoteInput = z.infer<typeof createVoteSchema>
export type UpdateVoteInput = z.infer<typeof updateVoteSchema>
export type VotesQueryInput = z.infer<typeof votesQuerySchema>
export type CastVoteInput = z.infer<typeof castVoteSchema>
