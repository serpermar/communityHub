// ---------------------------------------------------------------------------
// Validacion de entrada (zod).
//
// Se valida en el borde, antes de que nada toque la logica de negocio. El
// backend nunca confiar en lo que le manda el cliente, y el cliente nunca
// prevalidar en lugar de validar aqui: una prevalidacion es una cortesia, no una
// garantia.
//
// `.strict()` en todos los esquemas: una clave desconocida es un error, no algo
// que se ignora en silencio. Sin eso, un campo renombrado o mal escrito sigue
// mandandose y aparece un bug mas adelante que es dificil de localizar.
// ---------------------------------------------------------------------------

import { z } from 'zod'

/**
 * Politica de contrasena.
 *
 * 12 caracteres es el minimo (spec 01, seccion 5.1). No se exige composicion de
 * simbolos, mayusculas y numeros: esos requisitos empujan a la gente a escribir
 * contrasenas predecibles (`Password1!`), asi que el formato importa menos que
 * la longitud y que no sea una contrasena filtrada.
 */
const password = z
  .string()
  .min(12, 'La contraseña necesita al menos 12 caracteres.')
  .max(200, 'La contraseña es demasiado larga.')

const email = z
  .string()
  .trim()
  .min(1, 'El correo es obligatorio.')
  .max(320, 'El correo es demasiado largo.')
  // zod 4 expone `z.email()`; `z.string().email()` queda obsoleto.
  .pipe(z.email('El correo no tiene un formato válido.'))
  .transform((value) => value.toLowerCase())

export const registerSchema = z
  .object({
    email,
    password,
    fullName: z.string().trim().min(1, 'El nombre es obligatorio.').max(120),
    phone: z.string().trim().min(6).max(30).optional(),
  })
  .strict()

export const loginSchema = z
  .object({
    email,
    // Aqui no se aplica la politica de longitud: en el login solo se comprueba
    // que el formato sea plausible. Si alguien envia una contrasena de 3
    // caracteres, la respuesta correcta es "incorrecto", no "demasiado corta",
    // que confirmaria que la validacion del registro existe y es distinta.
    password: z.string().min(1, 'La contraseña es obligatoria.').max(200),
  })
  .strict()

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>

/** Convierte los issues de zod en el detalle que viaja en la respuesta de error. */
export function formatIssues(error: z.ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(raíz)',
    message: issue.message,
  }))
}