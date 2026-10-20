// ---------------------------------------------------------------------------
// Validación de entrada.
//
// Un endpoint que acepta campos desconocidos en silencio es un endpoint donde un
// error de escritura en el cliente tarda días en aparecer. Por eso `.strict()`.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from '../validators.js'

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

describe('updateProfileSchema', () => {
  it('acepta nombre y teléfono válidos', () => {
    expect(updateProfileSchema.safeParse({ fullName: 'Ana', phone: '+34600000001' }).success).toBe(
      true,
    )
  })

  it('permite vaciar el teléfono (cadena vacía)', () => {
    expect(updateProfileSchema.safeParse({ fullName: 'Ana', phone: '' }).success).toBe(true)
  })

  it('acepta la ausencia de teléfono', () => {
    expect(updateProfileSchema.safeParse({ fullName: 'Ana' }).success).toBe(true)
  })

  it('rechaza un nombre vacío', () => {
    expect(updateProfileSchema.safeParse({ fullName: '  ' }).success).toBe(false)
  })

  it('rechaza un teléfono demasiado corto', () => {
    expect(updateProfileSchema.safeParse({ fullName: 'Ana', phone: '123' }).success).toBe(false)
  })

  it('rechaza una clave desconocida', () => {
    expect(updateProfileSchema.safeParse({ fullName: 'Ana', email: 'x@y.test' }).success).toBe(
      false,
    )
  })
})

describe('changePasswordSchema', () => {
  it('acepta una contraseña actual y una nueva válida', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'la-de-antes-larga',
      newPassword: 'una-nueva-larga-12',
    })

    expect(result.success).toBe(true)
  })

  it('exige el mínimo de longitud en la nueva contraseña', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'la-de-antes-larga',
      newPassword: 'corta',
    })

    expect(result.success).toBe(false)
  })

  it('rechaza una contraseña actual vacía', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: '',
      newPassword: 'una-nueva-larga-12',
    })

    expect(result.success).toBe(false)
  })

  it('rechaza una clave desconocida', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'la-de-antes-larga',
      newPassword: 'una-nueva-larga-12',
      confirmPassword: 'una-nueva-larga-12',
    })

    expect(result.success).toBe(false)
  })
})
