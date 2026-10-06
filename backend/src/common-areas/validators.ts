// ---------------------------------------------------------------------------
// Validacion de entrada de zonas comunes (zod).
//
// Mismas reglas que en los modulos anteriores: validacion en el borde,
// `.strict()` en todos los esquemas y mensajes en castellano. Lo propio de este
// bloque:
//
//   - El ENUM `common_area_type` se lista aqui (ocho valores, 01_schema.sql).
//     Pasarlo como texto libre dejaria que un `::common_area_type` con basura
//     revienta con 22P02.
//   - `slotMinutes` se limita a {30, 60, 90, 120}, que es el CHECK
//     `common_areas_slot_valid` de la tabla. Zod y el CHECK dicen lo mismo a
//     proposito: el backend da un 400 que nombra el campo, la base de datos un
//     23514, y si los dos numeros dijeran cosas distintos ganaria el que se
//     comprobara antes.
//   - `openTime`/`closeTime` son `HH:MM` estricto, no un parser de horas. La
//     columna es `time`; un "8:00" sin cero a la izquierda no es lo que guarda
//     Postgres, y `close > open` se comprueba aqui con el mismo criterio que el
//     CHECK `common_areas_hours_valid`.
//   - `name` de 2 a 80, igual que `common_areas_name_length` (02f). Duplicarlo
//     es inevitable: el backend no puede leer las constraints, y si los dos
//     sitios dijeran numeros distintos, el que fallara primero seria el del
//     formulario, que es el 400 inutil de "este campo no es valido".
//
// CA-4 decide la diferencia entre POST y PUT: el POST admite campos ausentes
// (usan el default de la columna) y el PUT es reemplazo COMPLETO con todos los
// campos presentes. No hay PATCH porque la configuracion de una zona es un
// paquete coherente —horario, rejilla, limites—.
// ---------------------------------------------------------------------------

import { z } from 'zod'

/** Los ocho valores de `common_area_type` (01_schema.sql). */
const TIPOS = [
  'SWIMMING_POOL',
  'PADEL_COURT',
  'COMMUNITY_ROOM',
  'GYM',
  'TERRACE',
  'PLAYGROUND',
  'GARAGE',
  'OTHER',
] as const

/** Los cuatro valores validos de `slot_minutes` (CHECK `common_areas_slot_valid`). */
const REJILLAS = [30, 60, 90, 120] as const

/**
 * La rejilla.
 *
 * No es un `z.enum` porque esos solo admiten textos, y no es un numero libre
 * porque el mensaje tiene que nombrar los valores admitidos en castellano:
 * `slotMinutes: 45` debe decirlo en el 400, no caer en un "Invalid input"
 * generico del union de literales. Un numero con `.refine` da las dos cosas, y
 * el refine tambien descarta los decimales de paso.
 */
const rejilla = z
  .number()
  .refine((valor): valor is (typeof REJILLAS)[number] => (REJILLAS as ReadonlyArray<number>).includes(valor), {
    message: 'slotMinutes debe ser 30, 60, 90 o 120.',
  })

/** Mismo criterio que `members/validators.ts` (C-9). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Formato `HH:MM` estricto de 24 horas.
 *
 * Sin normalizar: "8:00" no se convierte en "08:00" porque la API no adivina.
 * El cliente que manda horas lo hace con el mismo formato que va a leer.
 */
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/

const hora = z
  .string()
  .regex(HORA_RE, 'La hora debe tener el formato HH:MM (de 00:00 a 23:59).')

/**
 * El nombre. 2-80, igual que `common_areas_name_length`.
 *
 * El minimo de 2 no es un capricho: es el CHECK. Con 1 caracter el backend lo
 * acepta, la funcion lo acepta y el INSERT revienta con 23514.
 */
const nombre = z
  .string()
  .trim()
  .min(2, 'El nombre debe tener al menos 2 caracteres.')
  .max(80, 'El nombre no puede pasar de 80 caracteres.')

/**
 * La descripcion. Anulable (CA-10), y el `.transform` hace que `''` y `null`
 * sean lo mismo antes de llegar al SQL, para que la funcion pueda usar el mismo
 * `nullif(btrim(p_description), '')` en los dos casos.
 */
const descripcion = z
  .string()
  .trim()
  .max(500, 'La descripción no puede pasar de 500 caracteres.')
  .nullish()
  .transform((value) => (value ? value : null))

/** Capacidad. Anulable, y `null` es "sin limite" (CA-10), no un 0. */
const capacidad = z
  .number()
  .int('La capacidad debe ser un número entero.')
  .min(1, 'La capacidad debe ser al menos 1.')
  .nullish()

/** Limite diario. Anulable, mismo criterio que capacidad (CA-10). */
const limiteDiario = z
  .number()
  .int('El límite diario debe ser un número entero.')
  .min(1, 'El límite diario debe ser al menos 1.')
  .nullish()

/**
 * Comprueba que `closeTime` es posterior a `openTime`.
 *
 * Es el mismo criterio que el CHECK `common_areas_hours_valid`, y se comprueba
 * aqui para que el 400 nombre los dos campos en vez de llegar como un 23514 sin
 * contexto. Solo cuando los DOS estan presentes: en el POST los dos ausentes
 * usan los defaults de la columna (08:00-22:00, que ya cuadran).
 */
function horarioValido(
  datos: { openTime?: string | null; closeTime?: string | null },
  addIssue: (mensaje: string, campo: 'openTime' | 'closeTime') => void,
): void {
  if (datos.openTime && datos.closeTime && datos.closeTime <= datos.openTime) {
    addIssue('La hora de cierre debe ser posterior a la de apertura.', 'closeTime')
  }
}

/**
 * Alta de una zona. Los diez campos de configuracion, casi todos opcionales.
 *
 * `communityId` NO se acepta: va en la URL, y con `.strict()` mandarlo es un
 * 400 que lo dice en vez de un 201 en el que el campo se ignora en silencio.
 * `id`, `createdBy`, `createdAt` y `updatedAt` tampoco: los pone la base de
 * datos.
 *
 * Los ausentes usan el default de la columna (spec 05 7.3): `type` OTHER,
 * `slotMinutes` 60, `openTime` 08:00, `closeTime` 22:00, `isActive` true, y
 * `null` para lo anulable (CA-10).
 */
export const createCommonAreaSchema = z
  .object({
    name: nombre,
    type: z.enum(TIPOS).optional(),
    description: descripcion,
    capacity: capacidad,
    slotMinutes: rejilla.optional(),
    openTime: hora.optional(),
    closeTime: hora.optional(),
    maxDailyReservations: limiteDiario,
    requiresApproval: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .superRefine((datos, ctx) => {
    horarioValido(datos, (message, path) => ctx.addIssue({ code: 'custom', message, path: [path] }))
  })

/**
 * PUT de configuracion. Los mismos diez campos, TODOS presentes (CA-4).
 *
 * Reemplazo completo, como el PUT de incidencias: un PUT parcial dejaria campos
 * sin tocar y el cliente tendria que saber de antemano el estado anterior.
 * `description`, `capacity` y `maxDailyReservations` son obligatorios pero
 * admiten `null`, porque vaciar un limite es una operacion real (CA-10) y sin
 * `null` no tendria forma de expresarse.
 *
 * `updated_at` se manda y da 400 por `.strict()`: lo pone el servidor.
 */
export const updateCommonAreaSchema = z
  .object({
    name: nombre,
    type: z.enum(TIPOS),
    description: z
      .string()
      .trim()
      .max(500, 'La descripción no puede pasar de 500 caracteres.')
      .nullable(),
    capacity: z
      .number()
      .int('La capacidad debe ser un número entero.')
      .min(1, 'La capacidad debe ser al menos 1.')
      .nullable(),
    slotMinutes: rejilla,
    openTime: hora,
    closeTime: hora,
    maxDailyReservations: z
      .number()
      .int('El límite diario debe ser un número entero.')
      .min(1, 'El límite diario debe ser al menos 1.')
      .nullable(),
    requiresApproval: z.boolean(),
    isActive: z.boolean(),
  })
  .strict()
  .superRefine((datos, ctx) => {
    horarioValido(datos, (message, path) => ctx.addIssue({ code: 'custom', message, path: [path] }))
  })

/**
 * Query de la disponibilidad.
 *
 * `date` es obligatoria y con formato estricto `YYYY-MM-DD`: `2026-2-5` es un
 * 400, no una fecha que se normaliza. Aceptar formatos variantes haria que dos
 * clientes pidieran "el mismo dia" y el backend resolviera dias distintos.
 *
 * El `.refine` del calendario evita el clasico `2026-02-31`, que la regex deja
 * pasar y que `::date` en Postgres rechazaria con un error poco claro.
 */
export const availabilityQuerySchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener el formato YYYY-MM-DD.')
      .refine((valor) => {
        const partes = valor.split('-')
        const anio = Number(partes[0])
        const mes = Number(partes[1])
        const dia = Number(partes[2])
        const fecha = new Date(Date.UTC(anio, mes - 1, dia))
        return (
          fecha.getUTCFullYear() === anio &&
          fecha.getUTCMonth() === mes - 1 &&
          fecha.getUTCDate() === dia
        )
      }, 'Esa fecha no existe en el calendario.'),
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
export const TIPOS_VALIDOS = TIPOS
export const REJILLAS_VALIDAS = REJILLAS

export type CreateCommonAreaInput = z.infer<typeof createCommonAreaSchema>
export type UpdateCommonAreaInput = z.infer<typeof updateCommonAreaSchema>
export type AvailabilityQueryInput = z.infer<typeof availabilityQuerySchema>
