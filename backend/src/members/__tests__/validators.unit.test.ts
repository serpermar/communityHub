// ---------------------------------------------------------------------------
// Validadores de miembros e invitaciones.
//
// Tests unitarios: no abren la base de datos. Lo que se comprueba aqui es la
// FORMA de lo que entra, que es la unica parte de este bloque que se puede
// comprobar sin Supabase.
//
// Lo importante de este archivo no es que zod funcione, sino el motivo de cada
// regla:
//   - El PATCH acepta `role` XOR `status` (spec 03, seccion 6).
//   - El correo se normaliza a minusculas, porque M-8 compara el correo de la
//     cuenta con el de la invitacion y los dos se guardan en minusculas.
//   - `.strict()` en los tres esquemas: una clave desconocida es un error, no algo
//     que se ignora en silencio.
//
// La normalizacion del correo NO se comprueba aqui con una regla de zod, sino que
// se deja para los tests de integracion, que son los que pueden comprobar que un
// codigo creado con `Marta@Ejemplo.Test` se puede canjear con una cuenta creada
// con `marta@ejemplo.test`. Esa equivalencia depende de las dos columnas y del
// `lower()` de SQL, no solo del validator.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import { inviteSchema, patchMemberSchema, redeemSchema, uuidSchema } from '../validators.js'

describe('inviteSchema', () => {
  it('acepta un correo y lo pasa a minusculas', () => {
    const resultado = inviteSchema.safeParse({ email: '  Marta@Ejemplo.Test ' })
    expect(resultado.success).toBe(true)
    if (resultado.success) {
      // El `trim` y el `toLowerCase` no son solo cosmeticos: sin ellos, la
      // comparacion de M-8 fallaria entre la cuenta y la invitacion.
      expect(resultado.data.email).toBe('marta@ejemplo.test')
    }
  })

  it('rechaza un correo sin forma de correo', () => {
    for (const malo of ['', '   ', 'no-es-un-correo', 'a@b', '@ejemplo.test', 'marta@', 'marta @ejemplo.test']) {
      expect(inviteSchema.safeParse({ email: malo }).success, `con ${JSON.stringify(malo)}`).toBe(false)
    }
  })

  it('rechaza un cuerpo sin correo', () => {
    expect(inviteSchema.safeParse({}).success).toBe(false)
  })

  it('rechaza que el cliente mande la caducidad, el rol o el codigo', () => {
    // Los tres los pone el servidor. Aceptarlos seria aceptar que el cliente
    // decida cuando caduca un codigo (M-7) o con que rol entra (M-9).
    const cuerpos = [
      { email: 'marta@ejemplo.test', expiresAt: '2099-01-01T00:00:00.000Z' },
      { email: 'marta@ejemplo.test', role: 'ADMIN' },
      { email: 'marta@ejemplo.test', code: 'todo-lo-que-quiera' },
      { email: 'marta@ejemplo.test', acceptedAt: null },
      { email: 'marta@ejemplo.test', communityId: '11111111-1111-4111-8111-111111111111' },
    ]

    for (const cuerpo of cuerpos) {
      expect(inviteSchema.safeParse(cuerpo).success, JSON.stringify(cuerpo)).toBe(false)
    }
  })

  it('rechaza un array o un texto donde se espera un objeto', () => {
    expect(inviteSchema.safeParse([]).success).toBe(false)
    expect(inviteSchema.safeParse('marta@ejemplo.test').success).toBe(false)
    expect(inviteSchema.safeParse(null).success).toBe(false)
  })
})

describe('patchMemberSchema', () => {
  it('acepta solo role', () => {
    const resultado = patchMemberSchema.safeParse({ role: 'ADMIN' })
    expect(resultado.success).toBe(true)
    // Y solo lo que se mando: un campo con transform apareceria aqui aunque no
    // venga, y el servicio escribiria un status que nadie pidio.
    if (resultado.success) expect(Object.keys(resultado.data)).toEqual(['role'])
  })

  it('acepta solo status', () => {
    const resultado = patchMemberSchema.safeParse({ status: 'SUSPENDED' })
    expect(resultado.success).toBe(true)
    if (resultado.success) expect(Object.keys(resultado.data)).toEqual(['status'])
  })

  it('acepta los cuatro roles y los tres estados', () => {
    for (const role of ['NEIGHBOR', 'PRESIDENT', 'ADMIN', 'PROVIDER']) {
      expect(patchMemberSchema.safeParse({ role }).success, role).toBe(true)
    }
    for (const status of ['ACTIVE', 'SUSPENDED', 'LEFT']) {
      expect(patchMemberSchema.safeParse({ status }).success, status).toBe(true)
    }
  })

  it('rechaza role y status a la vez', () => {
    // Son dos funciones de SQL y por tanto dos transacciones. Mandarlos juntos
    // dejaria al vecino a mitad de camino si la segunda fallara (spec 03, §6).
    const resultado = patchMemberSchema.safeParse({ role: 'PRESIDENT', status: 'SUSPENDED' })
    expect(resultado.success).toBe(false)
    if (!resultado.success) {
      expect(resultado.error.issues.some((i) => i.message.includes('no los dos'))).toBe(true)
    }
  })

  it('rechaza un cuerpo vacio', () => {
    const resultado = patchMemberSchema.safeParse({})
    expect(resultado.success).toBe(false)
    if (!resultado.success) {
      expect(resultado.error.issues.some((i) => i.message.includes('No hay nada que actualizar'))).toBe(true)
    }
  })

  it('rechaza un rol o un estado que no existe', () => {
    for (const malo of [
      { role: 'ADMIN_SA' }, // el rol de plataforma no es un rol de comunidad
      { role: 'admin' }, // en minuscula no vale
      { role: 'SUPERADMIN' },
      { status: 'DELETED' },
      { status: 'BANNED' },
      { status: 'active' },
      { role: 1 },
      { status: true },
    ]) {
      expect(patchMemberSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false)
    }
  })

  it('rechaza que el cliente mande unit_number (todavia no existe, §11)', () => {
    // La columna existe en la tabla y este bloque no la escribe. Aceptarla ahora
    // obligaria a decidir que es "borrarla" frente a "no mandarla", que en un
    // PATCH son cosas distintas.
    expect(patchMemberSchema.safeParse({ role: 'ADMIN', unitNumber: '3-B' }).success).toBe(false)
  })

  it('rechaza claves desconocidas', () => {
    expect(patchMemberSchema.safeParse({ role: 'ADMIN', id: 'x' }).success).toBe(false)
    expect(patchMemberSchema.safeParse({ role: 'ADMIN', userId: 'x' }).success).toBe(false)
    expect(patchMemberSchema.safeParse({ role: 'ADMIN', communityId: 'x' }).success).toBe(false)
    expect(patchMemberSchema.safeParse({ role: 'ADMIN', fullName: 'x' }).success).toBe(false)
  })
})

describe('redeemSchema', () => {
  it('acepta un codigo con espacios alrededor', () => {
    // El `trim` replica el `btrim` de `app_redeem_invitation()`: pegar el codigo
    // con un espacio de mas no lo invalida.
    const resultado = redeemSchema.safeParse({ code: '  abc123  ' })
    expect(resultado.success).toBe(true)
    if (resultado.success) expect(resultado.data.code).toBe('abc123')
  })

  it('rechaza un codigo vacio', () => {
    expect(redeemSchema.safeParse({ code: '' }).success).toBe(false)
    expect(redeemSchema.safeParse({ code: '   ' }).success).toBe(false)
    expect(redeemSchema.safeParse({}).success).toBe(false)
  })

  it('rechaza un codigo absurdamente largo', () => {
    // El codigo real son 64 hex. El limite no acota nada legitimo: acota lo que se
    // puede mandar antes de que sha256 lo convierta todo en lo mismo.
    expect(redeemSchema.safeParse({ code: 'a'.repeat(201) }).success).toBe(false)
    expect(redeemSchema.safeParse({ code: 'a'.repeat(200) }).success).toBe(true)
  })

  it('rechaza que el cliente elija la comunidad (M-10)', () => {
    const codigo = { code: 'abc123' }
    expect(redeemSchema.safeParse({ ...codigo, communityId: '11111111-1111-4111-8111-111111111111' }).success).toBe(
      false,
    )
    expect(redeemSchema.safeParse({ ...codigo, role: 'ADMIN' }).success).toBe(false)
    expect(redeemSchema.safeParse({ ...codigo, email: 'marta@ejemplo.test' }).success).toBe(false)
  })
})

describe('uuidSchema', () => {
  it('acepta un UUID bien formado', () => {
    expect(uuidSchema.safeParse('11111111-1111-4111-8111-111111111111').success).toBe(true)
    expect(uuidSchema.safeParse('ABCDEF01-1111-4111-8111-111111111111').success).toBe(true)
  })

  it('rechaza lo que no es un UUID', () => {
    // Mismo criterio que `requireUuidParam` del middleware (C-9): un id mal
    // formado es una peticion mal formada, y la respuesta es 400 y no 403.
    for (const malo of ['', 'no-es-un-uuid', '123', 'abc-def', '1234-5678', '11111111-1111-4111-8111']) {
      expect(uuidSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false)
    }
  })
})