// ---------------------------------------------------------------------------
// Contraseñas: argon2id.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import { equalizeTiming, hashPassword, verifyPassword } from '../password.js'

describe('hashPassword', () => {
  it('produce un hash argon2id con sal, de modo que dos hashes de la misma contraseña difieren', async () => {
    const a = await hashPassword('contraseña-larga-1')
    const b = await hashPassword('contraseña-larga-1')

    // Sin sal, dos usuarios con la misma contraseña tendrían el mismo hash, y
    // un atacante vería de un vistazo que comparten contraseña.
    expect(a).not.toBe(b)
    expect(a.startsWith('$argon2id$')).toBe(true)
  })

  it('nunca guarda la contraseña en claro dentro del hash', async () => {
    const password = 'contraseña-larga-2'
    const hash = await hashPassword(password)

    expect(hash).not.toContain(password)
  })
})

describe('verifyPassword', () => {
  it('acepta la contraseña correcta', async () => {
    const hash = await hashPassword('la-contraseña-correcta')

    expect(await verifyPassword(hash, 'la-contraseña-correcta')).toBe(true)
  })

  it('rechaza una contraseña distinta', async () => {
    const hash = await hashPassword('la-contraseña-correcta')

    expect(await verifyPassword(hash, 'la-contraseña-equivocada')).toBe(false)
  })

  it('devuelve false ante un hash corrupto, en vez de lanzar', async () => {
    // Un hash ilegible significa "esta credencial no verifica", no "el servidor
    // está roto". Lanzar convertiría un 401 en un 500.
    expect(await verifyPassword('no-es-un-hash', 'loquesea')).toBe(false)
    expect(await verifyPassword('', 'loquesea')).toBe(false)
  })

  it('devuelve false ante un hash de otro algoritmo (por ejemplo, uno scrypt antiguo)', async () => {
    // Es el caso real del seed antes de migrarlo a argon2id.
    const scryptLike = '$scrypt$ln=16,r=8,p=1$abcdefgh$0123456789abcdef'
    expect(await verifyPassword(scryptLike, 'loquesea')).toBe(false)
  })
})

describe('equalizeTiming', () => {
  it('ejecuta un coste comparable al de una verificación real', async () => {
    // Esta es la defensa contra la enumeración de cuentas por canal lateral: si
    // un login con email inexistente no cuesta lo mismo que uno con contraseña
    // incorrecta, el tiempo de respuesta dice si la cuenta existe.
    //
    // Se mide la mediana de varias ejecuciones porque la primera paga el
    // calentamiento de memoria de argon2 y las siguientes fluctúan. El margen es
    // amplio a propósito: este test verifica que existe la igualación, no que
    // argon2 sea una máquina de relojería.
    const samples: number[] = []

    await hashPassword('calentamiento-de-argon2')

    for (let i = 0; i < 5; i++) {
      const started = process.hrtime.bigint()
      await equalizeTiming('la-contraseña-que-se-haya-enviado')
      samples.push(Number(process.hrtime.bigint() - started) / 1e6)
    }

    const median = samples.sort((x, y) => x - y)[2]!

    expect(median).toBeGreaterThan(1)
  })
})