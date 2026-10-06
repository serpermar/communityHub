// ---------------------------------------------------------------------------
// Validacion de entrada de reservas (zod).
//
// Mismas reglas que en los modulos anteriores: validacion en el borde,
// `.strict()` en todos los esquemas y mensajes en castellano. Lo propio de este
// bloque:
//
//   - `status` NO se acepta en el POST (R-2). Nace de `requires_approval` de la
//     zona dentro de la funcion, y con `.strict()` mandarlo es un 400 que lo
//     dice en vez de un 201 en el que el campo se ignora en silencio. Lo mismo
//     para `userId` y `communityId`: el primero lo pone la sesion, la segunda
//     la decide la zona.
//   - `startsAt`/`endsAt` son ISO 8601 estricto. La comparacion `ends > starts`
//     se comprueba aqui con fechas de verdad y no por texto: dos cadenas ISO
//     con offsets distintos ("+02:00" y "Z") se compararian mal.
//   - `notes` se limita a 1000 (R-11) y el `''` se convierte en `null` antes de
//     llegar al SQL, para que la funcion pueda usar el mismo `nullif(p_notes,
//     '')` sin distinguir "sin notas" de "notas vacias".
//   - Los filtros de listado se validan aqui y no se pasan como texto crudo al
//     SQL: sin el cast de `::reservation_status`, `status=inventado` llegaria
//     como texto y Postgres lo rechazaria con 22P02, que es un 500 si nadie lo
//     traduce. Y el `offset` tiene que ser un entero de verdad.
// ---------------------------------------------------------------------------

import { z } from 'zod'

/** Los tres estados de `reservation_status` (01_schema.sql). */
const ESTADOS = ['PENDING', 'CONFIRMED', 'CANCELLED'] as const

/** Mismo criterio que `members/validators.ts` (C-9). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Fecha con formato estricto `YYYY-MM-DD`, sin normalizar.
 *
 * `2026-2-5` es un 400, no una fecha que se arregla: aceptar variantes haria
 * que dos clientes pidieran "el mismo dia" y el backend resolviera dias
 * distintos. El `.refine` del calendario evita el clasico `2026-02-31`, que la
 * regex deja pasar y que `::date` en Postgres rechazaria con un error poco
 * claro.
 */
const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener el formato YYYY-MM-DD.')
  .refine((valor) => {
    const partes = valor.split('-')
    const anio = Number(partes[0])
    const mes = Number(partes[1])
    const dia = Number(partes[2])
    const d = new Date(Date.UTC(anio, mes - 1, dia))
    return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia
  }, 'Esa fecha no existe en el calendario.')

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
 * Alta de una reserva.
 *
 * `status`, `userId` y `communityId` NO estan en el esquema y no hay forma de
 * mandarlos (R-2, R-6). `attendees` es opcional porque la asistencia es
 * opcional en el esquema; `notes` tambien, y el `''` se guarda como `null`
 * (R-11).
 *
 * `endsAt > startsAt` se comprueba aqui y dentro de la funcion (R-7, guarda 6).
 * Esta es la capa que da el 400 con el nombre del campo; aquella es la que
 * protege si alguien llama a la funcion por otro camino.
 */
export const createReservationSchema = z
  .object({
    startsAt: instante,
    endsAt: instante,
    attendees: z
      .number()
      .int('La asistencia debe ser un número entero.')
      .min(1, 'La asistencia debe ser al menos 1.')
      .optional(),
    notes: z
      .string()
      .trim()
      .max(1000, 'Las notas no pueden pasar de 1000 caracteres.')
      .nullish()
      .transform((value) => (value ? value : null)),
  })
  .strict()
  .superRefine((datos, ctx) => {
    // Comparacion por instante y no por cadena: dos ISO con offsets distintos
    // se ordenarian mal por texto ("+02:00" > "Z" a igualdad de prefijo).
    if (Date.parse(datos.startsAt) >= Date.parse(datos.endsAt)) {
      ctx.addIssue({
        code: 'custom',
        message: 'El fin de la reserva debe ser posterior al inicio.',
        path: ['endsAt'],
      })
    }
  })

/**
 * Cancelar o confirmar.
 *
 * No hay campos que cambiar: cancelar es cancelar y confirmar es confirmar.
 * `.strict()` mas un objeto vacio es lo que hace que un PATCH con `{status}` sea
 * un 400 explicito en vez de una operacion que ignora el cuerpo.
 *
 * El cuerpo puede venir ausente (`undefined`), que es lo que manda un cliente
 * que hace `fetch` sin body: el controller lo normaliza a `{}`.
 */
export const emptyBodySchema = z.object({}).strict()

/**
 * Filtros del listado de comunidad.
 *
 * `page` y no `offset`: la API expone `meta.page`, que es lo que consume el
 * cliente, y convertirlo aqui evita que el servicio tenga que restar uno en un
 * solo sitio. `limit` por defecto 20, igual que el resto del proyecto.
 */
export const listQuerySchema = z
  .object({
    commonAreaId: z.string().regex(UUID_RE, 'commonAreaId debe ser un UUID.').optional(),
    date: fecha.optional(),
    status: z.enum(ESTADOS).optional(),
    page: z.coerce.number().int('La página debe ser un número entero.').min(1, 'La página empieza en 1.').optional(),
    limit: z.coerce.number().int('El límite debe ser un número entero.').min(1).max(100, 'El límite máximo es 100.').optional(),
  })
  .strict()

/**
 * Filtros de `GET /reservations/me`.
 *
 * Sin `commonAreaId` ni `date`: el ambito es el usuario, y la agenda propia
 * cruza comunidades (R-5), donde filtrar por una zona de una comunidad concreta
 * no tendria sentido sin comunidad en la ruta.
 */
export const meQuerySchema = z
  .object({
    status: z.enum(ESTADOS).optional(),
    page: z.coerce.number().int('La página debe ser un número entero.').min(1, 'La página empieza en 1.').optional(),
    limit: z.coerce.number().int('El límite debe ser un número entero.').min(1).max(100, 'El límite máximo es 100.').optional(),
  })
  .strict()

/**
 * Un UUID de ruta.
 *
 * Se exporta como esquema para que el controller lo valide con el mismo `parse`
 * que usa para los cuerpos, en vez de un segundo camino de validacion.
 */
export const uuidSchema = z.string().regex(UUID_RE, 'Debe ser un UUID.')

/** Los valores admitidos, para los mensajes de error de los tests. */
export const ESTADOS_VALIDOS = ESTADOS

export type CreateReservationInput = z.infer<typeof createReservationSchema>
export type ListQueryInput = z.infer<typeof listQuerySchema>
export type MeQueryInput = z.infer<typeof meQuerySchema>
