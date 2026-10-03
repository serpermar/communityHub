// ---------------------------------------------------------------------------
// Validación de entrada.
//
// Un endpoint que acepta campos desconocidos en silencio es un endpoint donde un
// error de escritura en el cliente tarda días en aparecer. Por eso `.strict()`.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import { loginSchema, registerSchema } from '../validators.js'

const valid = {
  email: 'ana@comunidad-a.test',
  password: 'una-contraseña-larga',
  fullName: 'Ana Ruiz Delgado',
}

describe('registerSchema', () => {
  it('acepta una entrada válida y normaliza el email a minúsculas', () => {
    const result = registerSchema.parse({ ...valid, email: '  Ana@Comunidad-A.TEST ' })

    expect(result.email).toBe('ana@comunidad-a.test')
  })

  it('rechaza una contraseña de menos de 12 caracteres', () => {
    const result = registerSchema.safeParse({ ...valid, password: 'corta123' })

    expect(result.success).toBe(false)
  })

  it('acepta una contraseña de exactamente 12 caracteres', () => {
    const result = registerSchema.safeParse({ ...valid, password: 'docecaracter' })

    expect(result.success).toBe(true)
  })

  it('no exige símbolos ni mayúsculas, solo longitud', () => {
    // Exigir composición empuja a contraseñas predecibles tipo Password1!,
    // que es peor que una frase larga sin símbolos.
    const result = registerSchema.safeParse({ ...valid, password: 'una frase larga normal' })

    expect(result.success).toBe(true)
  })

  it('rechaza un email con formato inválido', () => {
    expect(registerSchema.safeParse({ ...valid, email: 'no-es-un-email' }).success).toBe(false)
  })

  it('rechaza un nombre vacío', () => {
    expect(registerSchema.safeParse({ ...valid, fullName: '   ' }).success).toBe(false)
  })

  it('rechaza una clave desconocida en vez de ignorarla', () => {
    const result = registerSchema.safeParse({ ...valid, isAdmin: true })

    expect(result.success).toBe(false)
  })

  it('acepta el teléfono como opcional', () => {
    expect(registerSchema.safeParse(valid).success).toBe(true)
    expect(registerSchema.safeParse({ ...valid, phone: '+34600000001' }).success).toBe(true)
  })
})

describe('loginSchema', () => {
  it('no aplica la política de longitud al login', () => {
    // Si el login exigiera 12 caracteres, un envío corto respondería
    // "contraseña demasiado corta" en vez de "credenciales incorrectas", y eso
    // confirmaría que la validación del registro existe y es distinta.
    const result = loginSchema.safeParse({ email: valid.email, password: 'corta' })

    expect(result.success).toBe(true)
  })

  it('rechaza una contraseña vacía', () => {
    expect(loginSchema.safeParse({ email: valid.email, password: '' }).success).toBe(false)
  })

  it('normaliza el email igual que el registro', () => {
    const result = loginSchema.parse({ email: 'ANA@Comunidad-A.test', password: 'lo-que-sea' })

    expect(result.email).toBe('ana@comunidad-a.test')
  })
})