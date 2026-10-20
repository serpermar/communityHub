import { z } from 'zod'

export const profileSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, 'El nombre es obligatorio.')
    .max(120, 'Nombre demasiado largo.'),
  phone: z.string().trim().max(30, 'El teléfono es demasiado largo.').optional().or(z.literal('')),
})

export const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'La contraseña actual es obligatoria.'),
    newPassword: z.string().min(12, 'La contraseña debe tener al menos 12 caracteres.').max(200),
    confirmPassword: z.string().min(1, 'Repite la nueva contraseña.'),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Las contraseñas no coinciden.',
  })

export type ProfileForm = z.infer<typeof profileSchema>
export type PasswordForm = z.infer<typeof passwordSchema>
