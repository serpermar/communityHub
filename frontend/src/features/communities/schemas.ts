import { z } from 'zod'

export const createCommunitySchema = z.object({
  name: z.string().min(3, 'El nombre debe tener al menos 3 caracteres.'),
  slug: z.string().min(3, 'El slug debe tener al menos 3 caracteres.'),
  addressLine1: z.string().min(5, 'La dirección es obligatoria.'),
  city: z.string().min(2, 'La ciudad es obligatoria.'),
  province: z.string().min(2, 'La provincia es obligatoria.'),
  postalCode: z.string().regex(/^\d{5}$/, 'El código postal debe tener 5 dígitos.'),
  description: z.string().optional(),
})

export const updateCommunitySchema = z.object({
  name: z.string().min(3, 'El nombre debe tener al menos 3 caracteres.'),
  slug: z
    .string()
    .min(3, 'El slug debe tener al menos 3 caracteres.')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Solo minúsculas, números y guiones.'),
  addressLine1: z.string().min(5, 'La dirección es obligatoria.'),
  city: z.string().min(2, 'La ciudad es obligatoria.'),
  province: z.string().min(2, 'La provincia es obligatoria.'),
  postalCode: z.string().regex(/^\d{5}$/, 'El código postal debe tener 5 dígitos.'),
  description: z.string().optional(),
  isActive: z.boolean(),
})

export type CreateCommunityForm = z.infer<typeof createCommunitySchema>
export type UpdateCommunityForm = z.infer<typeof updateCommunitySchema>
