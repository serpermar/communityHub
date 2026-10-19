// ---------------------------------------------------------------------------
// Validacion de entrada de IA (zod).
//
// Mismas reglas que en los modulos 04-10: validacion en el borde, `.strict()` en
// todos los esquemas y mensajes en castellano. Lo propio de este bloque:
//
//   - Los enums de incidencia (`category`, `priority`) se listan. El modelo o el
//     cliente pueden mandar cualquier cosa, y un `::incident_category` con basura
//     revienta en Postgres con 22P02, que sin traduccion es un 500.
//   - `Proposal` es el contrato de la propuesta (spec §7.3): title 3..120,
//     description 1..2000, confidence 0..1. Es lo que devuelve `classify` y lo que
//     acepta `drafts` cuando el frontend la manda ya calculada (D-2).
//   - El `confirm` acepta un `p_patch` PARCIAL: los limites de `title` y
//     `description` son los de `incidents` (5..200 / 10..4000), no los del
//     `Proposal`, porque es una fila de `incidents` la que se acaba insertando.
//   - `chat` es `sessionId?` + `communityId?` + `message`. Ni `userId` ni el rol:
//     salen de la sesion, nunca del cuerpo.
// ---------------------------------------------------------------------------

import { z } from 'zod'

/** Las siete categorias de `incident_category` (01_schema.sql). */
export const CATEGORIAS = [
  'ELEVATOR',
  'ELECTRICITY',
  'PLUMBING',
  'CLEANING',
  'SECURITY',
  'HEATING',
  'OTHER',
] as const

/** Las cuatro prioridades de `incident_priority`. */
export const PRIORIDADES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const

/** Mismo criterio que `members/validators.ts` (C-9). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const uuid = z.string().regex(UUID_RE, 'Debe ser un UUID.')

const categoria = z.enum(CATEGORIAS, { error: 'La categoría no es válida.' })
const prioridad = z.enum(PRIORIDADES, { error: 'La prioridad no es válida.' })

/**
 * La propuesta de incidencia (AI-2). Coincide con el `Proposal` de la spec: es
 * un OBJETO, no un texto, para que el frontend la pinte sin parsear nada.
 */
export const proposalSchema = z
  .object({
    category: categoria,
    priority: prioridad,
    title: z
      .string()
      .trim()
      .min(3, 'El título debe tener al menos 3 caracteres.')
      .max(120, 'El título no puede pasar de 120 caracteres.'),
    description: z
      .string()
      .trim()
      .min(1, 'La descripción no puede estar vacía.')
      .max(2000, 'La descripción no puede pasar de 2000 caracteres.'),
    confidence: z.coerce.number().min(0).max(1),
    needsHumanReview: z.boolean(),
  })
  .strict()

/** `POST /ai/chat`: mensaje del usuario, sesion y comunidad opcionales. */
export const chatBodySchema = z
  .object({
    sessionId: uuid.optional(),
    communityId: uuid.optional(),
    message: z
      .string()
      .trim()
      .min(1, 'El mensaje no puede estar vacío.')
      .max(4000, 'El mensaje no puede pasar de 4000 caracteres.'),
  })
  .strict()

/** `POST /ai/incidents/classify`: solo la comunidad y el texto. */
export const classifyBodySchema = z
  .object({
    communityId: uuid,
    description: z
      .string()
      .trim()
      .min(3, 'La descripción debe tener al menos 3 caracteres.')
      .max(2000, 'La descripción no puede pasar de 2000 caracteres.'),
  })
  .strict()

/**
 * `POST /ai/incidents/drafts` (D-2). La `proposal` es opcional: si viene, no se
 * reclasifica; si no, se calcula con el clasificador.
 */
export const draftBodySchema = z
  .object({
    communityId: uuid,
    description: z
      .string()
      .trim()
      .min(3, 'La descripción debe tener al menos 3 caracteres.')
      .max(2000, 'La descripción no puede pasar de 2000 caracteres.'),
    proposal: proposalSchema.optional(),
  })
  .strict()

/**
 * `POST /ai/incidents/drafts/:id/confirm`. Todos los campos opcionales: es un
 * parche sobre la propuesta almacenada. Los limites de `title`/`description` son
 * los de `incidents` (5..200 / 10..4000): es una incidencia lo que se crea.
 */
export const confirmBodySchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(5, 'El título debe tener al menos 5 caracteres.')
      .max(200, 'El título no puede pasar de 200 caracteres.')
      .optional(),
    description: z
      .string()
      .trim()
      .min(10, 'La descripción debe tener al menos 10 caracteres.')
      .max(4000, 'La descripción no puede pasar de 4000 caracteres.')
      .optional(),
    category: categoria.optional(),
    priority: prioridad.optional(),
    location: z
      .string()
      .trim()
      .max(200, 'La ubicación no puede pasar de 200 caracteres.')
      .optional(),
  })
  .strict()

/** `POST /ai/tools/:toolName/preview`: comunidad obligatoria para autorizar. */
export const previewBodySchema = z
  .object({
    communityId: uuid,
    args: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()

/** Paginacion de sesiones y mensajes, igual que en el resto del proyecto. */
export const paginationQuerySchema = z
  .object({
    page: z.coerce
      .number()
      .int('La página debe ser un número entero.')
      .min(1, 'La página empieza en 1.')
      .optional(),
    limit: z.coerce
      .number()
      .int('El límite debe ser un número entero.')
      .min(1)
      .max(100, 'El límite máximo es 100.')
      .optional(),
  })
  .strict()

/** El nombre de una tool de la ruta. Un nombre raro sera un 404, no un 400. */
export const toolNameSchema = z.string().trim().min(1).max(100)

/** Un UUID de ruta. */
export const uuidSchema = uuid

/** Los valores admitidos, para los mensajes de error de los tests. */
export const CATEGORIAS_VALIDAS = CATEGORIAS
export const PRIORIDADES_VALIDAS = PRIORIDADES

export type ProposalInput = z.infer<typeof proposalSchema>
export type ChatBodyInput = z.infer<typeof chatBodySchema>
export type ClassifyBodyInput = z.infer<typeof classifyBodySchema>
export type DraftBodyInput = z.infer<typeof draftBodySchema>
export type ConfirmBodyInput = z.infer<typeof confirmBodySchema>
export type PreviewBodyInput = z.infer<typeof previewBodySchema>
export type PaginationQueryInput = z.infer<typeof paginationQuerySchema>
