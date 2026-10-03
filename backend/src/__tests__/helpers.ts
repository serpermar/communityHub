// ---------------------------------------------------------------------------
// Utilidades compartidas por los tests de integración.
//
// Cada test crea sus propios usuarios con un email único, para que la suite sea
// reejecutable sin limpiar nada antes y sin que dos tests se pisen los datos.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { createApp } from '../app.js'
import { prisma } from '../db.js'

/** Contraseña de 12+ caracteres: cumple la política del registro. */
export const TEST_PASSWORD = 'CommunityHub2026'

export function uniqueEmail(prefix = 'test'): string {
  return `${prefix}-${randomUUID()}@communityhub.test`
}

// Una sola instancia de la app para toda la suite. Se cachea a mano en vez de
// llamar a createApp() por test porque cada instancia crea sus propios limiters
// de peticiones, y un test que agota el limite del login dejaría al siguiente
// sin poder entrar. Los tests que necesitan provocar un 429 usan una app
// aparte (ver auth.api.test.ts).
let cachedApp: ReturnType<typeof createApp> | null = null

export function app() {
  cachedApp ??= createApp()
  return cachedApp
}

export type TestUser = {
  id: string
  email: string
  password: string
}

/**
 * Crea un usuario directamente en la base de datos.
 *
* Se inserta con el contexto de RLS puesto a ese mismo usuario, para que el test
 * vaya por el mismo camino que la aplicación y no por un atajo con el rol
 * postgres que no existiría en producción.
 *
 * No se usa el endpoint de registro a propósito: algunos tests necesitan un
 * usuario que existe pero nunca ha iniciado sesión, y meterlo por la API le
 * dejaría con sesión abierta siempre.
 */
export async function createUser(
  overrides: { email?: string; fullName?: string; globalRole?: 'NEIGHBOR' | 'ADMIN_SA' } = {},
): Promise<TestUser> {
  const { hashPassword } = await import('../auth/password.js')

  const id = randomUUID()
  const email = overrides.email ?? uniqueEmail()
  const password = TEST_PASSWORD
  const passwordHash = await hashPassword(password)

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.current_user_id', ${id}, true)`
    await tx.$executeRaw`select set_config('app.current_community_id', ${''}, true)`
    await tx.users.createMany({
      data: [
        {
          id,
          email,
          password_hash: passwordHash,
          full_name: overrides.fullName ?? 'Usuario de Prueba',
          global_role: overrides.globalRole ?? 'NEIGHBOR',
        },
      ],
    })
  })

  return { id, email, password }
}

/** Borra un usuario y todo lo que cuelgue de él (sesiones incluidas, por cascada). */
export async function deleteUser(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.current_user_id', ${userId}, true)`
    await tx.$executeRaw`select set_config('app.current_community_id', ${''}, true)`
    await tx.users.deleteMany({ where: { id: userId } })
  })
}

/** El valor del refresh token en la cabecera Set-Cookie. */
export function refreshCookieValue(res: { headers: Record<string, unknown> }): string | null {
  const raw = (res.headers['set-cookie'] ?? []) as string[]
  const match = raw.find((c) => c.startsWith('refresh_token='))
  return match ? (match.split(';')[0]?.split('=')[1] ?? null) : null
}

/** El `Set-Cookie` completo, para comprobar atributos como HttpOnly y SameSite. */
export function refreshCookieHeader(res: { headers: Record<string, unknown> }): string | null {
  const raw = (res.headers['set-cookie'] ?? []) as string[]
  return raw.find((c) => c.startsWith('refresh_token=')) ?? null
}

/**
 * Todos los valores de `Set-Cookie` en una sola cadena.
 *
 * Express envía varios `Set-Cookie` en cabeceras separadas, pero los tipos de
 * supertest lo tipan como un único string. Esta función normaliza ambas formas
 * para que los tests no tengan que hacerlo.
 */
export function allSetCookies(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie']
  if (Array.isArray(raw)) return raw.join(' | ')
  return typeof raw === 'string' ? raw : ''
}