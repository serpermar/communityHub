import { z } from 'zod'
import { INCIDENT_CATEGORIES, INCIDENT_PRIORITIES } from './types'

export const createIncidentSchema = z.object({
  title: z
    .string()
    .trim()
    .min(5, 'El título debe tener al menos 5 caracteres.')
    .max(200, 'El título no puede pasar de 200 caracteres.'),
  description: z
    .string()
    .trim()
    .min(10, 'La descripción debe tener al menos 10 caracteres.')
    .max(4000, 'La descripción no puede pasar de 4000 caracteres.'),
  category: z.enum(INCIDENT_CATEGORIES).optional(),
  priority: z.enum(INCIDENT_PRIORITIES).optional(),
  location: z.string().trim().max(200, 'La ubicación no puede pasar de 200 caracteres.').optional(),
})

export const commentSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'El comentario no puede estar vacío.')
    .max(2000, 'El comentario no puede pasar de 2000 caracteres.'),
})

export type CreateIncidentForm = z.infer<typeof createIncidentSchema>
export type CommentForm = z.infer<typeof commentSchema>
