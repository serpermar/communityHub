// ---------------------------------------------------------------------------
// Validacion de entrada del modulo de notificaciones (spec 14 §10).
//
// Solo hay dos cosas que validar: la query del listado y el `:id` de la ruta de
// marcado. No hay cuerpo en ninguna ruta.
//
// El filtro `unread` NO se valida con `z.coerce.boolean()`: esa coercion
// convierte cualquier cadena no vacia en `true`, asi que `?unread=quizá` seria
// `true` en silencio. Se acepta SOLO la pareja `"true"`/`"false"`; cualquier
// otro valor es un 400 (spec 14 §10).
// ---------------------------------------------------------------------------

import { z } from 'zod'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Un UUID con forma de UUID, o un 400. Mismo criterio que el resto (C-9). */
export const uuidSchema = z.string().regex(UUID_RE, 'Debe ser un UUID.')

/**
 * La query del listado: `?unread=&page=&limit=`.
 *
 * `page` empieza en 1 y `limit` va de 1 a 100 (spec 14 §5, NTF-5); los defaults
 * (`page=1`, `limit=20`) se aplican aqui, no en SQL, para que `meta` describa el
 * mismo trozo de pagina que se devuelve.
 */
export const listQuerySchema = z
  .object({
    unread: z.enum(['true', 'false'], { message: 'El filtro "unread" debe ser "true" o "false".' }).optional(),
    page: z.coerce.number().int('La página debe ser un número entero.').min(1, 'La página empieza en 1.').optional(),
    limit: z.coerce.number().int('El límite debe ser un número entero.').min(1).max(100, 'El límite máximo es 100.').optional(),
  })
  .strict()
  .transform((valor) => ({
    unread: valor.unread === 'true',
    page: valor.page ?? 1,
    limit: valor.limit ?? 20,
  }))

export type ListQueryInput = z.infer<typeof listQuerySchema>
