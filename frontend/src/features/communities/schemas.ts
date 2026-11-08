import { z } from 'zod'

/**
 * El slug acaba en la URL (`/c/:slug`), asi que se valida aqui con la misma
 * regla que el backend: minusculas, numeros y guiones, sin guion al principio ni
 * al final. Antes solo se comprobaba la longitud en el alta, y el error llegaba
 * del servidor despues de enviar el formulario entero.
 */
const slug = z
  .string()
  .trim()
  .min(3, 'El slug debe tener al menos 3 caracteres.')
  .max(60, 'El slug es demasiado largo.')
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Solo minúsculas, números y guiones, sin guiones al principio ni al final.',
  )

// Los maximos replican los del backend para que el formulario no acepte algo que
// el servidor va a rechazar con un 400.
export const createCommunitySchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, 'El nombre debe tener al menos 3 caracteres.')
    .max(120, 'El nombre es demasiado largo.'),
  slug,
  addressLine1: z
    .string()
    .trim()
    .min(5, 'La dirección es obligatoria.')
    .max(200, 'La dirección es demasiado larga.'),
  city: z
    .string()
    .trim()
    .min(2, 'La ciudad es obligatoria.')
    .max(80, 'La ciudad es demasiado larga.'),
  province: z
    .string()
    .trim()
    .min(2, 'La provincia es obligatoria.')
    .max(80, 'La provincia es demasiado larga.'),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{5}$/, 'El código postal debe tener 5 dígitos.'),
  description: z.string().trim().max(2000, 'La descripción es demasiado larga.').optional(),
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
