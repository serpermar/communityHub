import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'El correo es obligatorio.').email('Introduce un correo válido.'),
  password: z.string().min(1, 'La contraseña es obligatoria.'),
})

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'El nombre es obligatorio.').max(120, 'Nombre demasiado largo.'),
  email: z.string().trim().min(1, 'El correo es obligatorio.').email('Introduce un correo válido.'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.'),
  phone: z
    .string()
    .trim()
    .max(30, 'El teléfono es demasiado largo.')
    .optional()
    .or(z.literal('')),
})

export type LoginForm = z.infer<typeof loginSchema>
export type RegisterForm = z.infer<typeof registerSchema>
