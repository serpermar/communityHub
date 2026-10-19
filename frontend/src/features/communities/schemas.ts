import { z } from 'zod'

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const createCommunitySchema = z.object({
  name: z.string().trim().min(2, 'El nombre es obligatorio.').max(120, 'Nombre demasiado largo.'),
  slug: z
    .string()
    .trim()
    .min(2, 'El identificador es obligatorio.')
    .max(80, 'Identificador demasiado largo.')
    .regex(
      slugPattern,
      'Solo minúsculas, números y guiones simples (sin empezar ni acabar en guion).',
    ),
  addressLine1: z.string().trim().min(1, 'La dirección es obligatoria.').max(200),
  city: z.string().trim().min(1, 'La ciudad es obligatoria.').max(120),
  description: z
    .string()
    .trim()
    .max(1000, 'Descripción demasiado larga.')
    .optional()
    .or(z.literal('')),
})

export const updateCommunitySchema = z.object({
  name: z.string().trim().min(2, 'El nombre es obligatorio.').max(120),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  addressLine1: z.string().trim().min(1, 'La dirección es obligatoria.').max(200),
  city: z.string().trim().min(1, 'La ciudad es obligatoria.').max(120),
  isActive: z.boolean(),
})

export type CreateCommunityForm = z.infer<typeof createCommunitySchema>
export type UpdateCommunityForm = z.infer<typeof updateCommunitySchema>
