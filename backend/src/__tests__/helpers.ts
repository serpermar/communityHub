// ---------------------------------------------------------------------------
// Utilidades compartidas por los tests de integracion.
//
// ---------------------------------------------------------------------------
// La regla que explica todo este archivo: sembrar con privilegio, afirmar con
// restriccion.
//
// Los fixtures se crean con `admin` (rol postgres, BYPASSRLS) porque el rol de la
// aplicacion no siempre puede crearlos. Y no es un atajo comodo: `expenses` es de
// solo lectura para `app_runtime` a proposito, y `users` no tiene DELETE. Los tests
// que usaban el rol de runtime para crear datos fallaban con errores de permisos
// que no decian nada sobre su causa real.
//
// Matiz para `communities`: desde el bloque 02 SI se puede escribir en ella, pero
// solo un `ADMIN_SA` y con `created_by` propio, por `communities_insert_admin_sa`.
// Los fixtures de comunidad siguen usando `admin` porque una comunidad de prueba
// no tiene por que tener un staff que la haya creado, y poner un `ADMIN_SA` solo
// para poder crearla seria contaminar el escenario que se quiere probar.
//
// En cambio, lo que se COMPRUEBA va siempre por el rol de runtime, a traves de
// `withContext` o de la propia API. Si un test afirmara sobre `admin` no estaria
// probando RLS: probaria que una tabla tiene filas.
//
// Esa asimetria es el test. El admin coloca, el vecino intenta mirar.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import type { expense_category, incident_category, incident_priority, member_role } from '@prisma/client'
import { createApp } from '../app.js'
import { admin } from '../db-admin.js'

/** Contrasena de 12+ caracteres: cumple la politica del registro. */
export const TEST_PASSWORD = 'CommunityHub2026'

export function uniqueEmail(prefix = 'test'): string {
  return `${prefix}-${randomUUID()}@communityhub.test`
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

// Una sola instancia para toda la suite. Se cachea a mano en vez de llamar a
// createApp() por test porque cada instancia crea sus propios limiters de
// peticiones, y un test que agota el limite del login dejaria al siguiente sin
// poder entrar. Los tests que necesitan provocar un 429 usan una app aparte.
let cachedApp: ReturnType<typeof createApp> | null = null

export function app() {
  cachedApp ??= createApp()
  return cachedApp
}

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

export type TestUser = {
  id: string
  email: string
  password: string
}

/**
 * Crea un usuario directamente en la base de datos.
 *
 * No se usa el endpoint de registro a proposito: algunos tests necesitan un
 * usuario que existe pero nunca ha iniciado sesion, y meterlo por la API le
 * dejaria con sesion abierta siempre.
 */
export async function createUser(
  overrides: { email?: string; fullName?: string; globalRole?: 'NEIGHBOR' | 'ADMIN_SA' } = {},
): Promise<TestUser> {
  const { hashPassword } = await import('../auth/password.js')

  const id = randomUUID()
  const email = overrides.email ?? uniqueEmail()
  const password = TEST_PASSWORD
  const passwordHash = await hashPassword(password)

  await admin.users.create({
    data: {
      id,
      email,
      password_hash: passwordHash,
      full_name: overrides.fullName ?? 'Usuario de Prueba',
      global_role: overrides.globalRole ?? 'NEIGHBOR',
    },
  })

  return { id, email, password }
}

/**
 * Crea un usuario con el rol de plataforma `ADMIN_SA`.
 *
 * Existe como funcion aparte y no como un `globalRole` mas de `createUser`
 * porque el nombre dice lo que el test necesita saber. Un `createUser({
 * globalRole: 'ADMIN_SA' })` obligaria a ir a mirar el enum para saber si es un
 * ADMIN de plataforma o un ADMIN de comunidad, y son permisos distintos: el
 * primero crea comunidades, el segundo solo gestiona las suyas.
 *
 * Este usuario NO es miembro de ninguna comunidad, y eso es parte de lo que se
 * prueba: el staff crea comunidades pero no lee las que ya hay (C-12).
 */
export async function makeAdminSa(overrides: { email?: string; fullName?: string } = {}): Promise<TestUser> {
  return createUser({ ...overrides, globalRole: 'ADMIN_SA' })
}

/**
 * Borra un usuario y todo lo que cuelgue de el.
 *
 * Necesita `admin` porque `app_runtime` no tiene DELETE sobre `users`. Con el
 * rol de runtime esta llamada fallaba y el `.catch()` del que la envolvia se
 * comia el error: los tests pasaban y la base de datos se llenaba de usuarios.
 * El fallo era invisible justo porque estaba escondido.
 */
export async function deleteUser(userId: string): Promise<void> {
  await admin.users.delete({ where: { id: userId } })
}

// ---------------------------------------------------------------------------
// Comunidades, membresias y datos de comunidad
// ---------------------------------------------------------------------------

export async function makeCommunity(name: string): Promise<string> {
  const id = randomUUID()
  await admin.communities.create({
    data: {
      id,
      name,
      slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${id.slice(0, 8)}`,
      address_line1: 'Calle de Prueba 1',
      city: 'Zaragoza',
      country: 'ES',
      latitude: 41.6488,
      longitude: -0.8891,
    },
  })
  return id
}

export async function makeMember(userId: string, communityId: string, role: member_role = 'NEIGHBOR'): Promise<void> {
  await admin.communityMembers.create({
    data: { community_id: communityId, user_id: userId, role },
  })
}

export async function makeIncident(
  communityId: string,
  reporterId: string,
  overrides: {
    title?: string
    description?: string
    category?: incident_category
    priority?: incident_priority
  } = {},
): Promise<string> {
  const id = randomUUID()
  await admin.incidents.create({
    data: {
      id,
      community_id: communityId,
      title: overrides.title ?? 'Incidencia de prueba',
      description: overrides.description ?? 'Descripcion de prueba.',
      category: overrides.category ?? 'OTHER',
      priority: overrides.priority ?? 'LOW',
      status: 'OPEN',
      reporter_id: reporterId,
      reference_code: randomUUID().slice(0, 8),
    },
  })
  return id
}

/**
 * `expenses` es de solo lectura para `app_runtime` a proposito: las escrituras
 * pasan por funcion dedicada para dejar rastro de auditoria. Por eso el fixture
 * tiene que usar `admin`, y por eso el test afirma con `withContext`.
 */
export async function makeExpense(
  communityId: string,
  createdBy: string,
  concept = 'Gasto de prueba',
  category: expense_category = 'MAINTENANCE',
): Promise<string> {
  const id = randomUUID()
  await admin.expenses.create({
    data: {
      id,
      community_id: communityId,
      concept,
      category,
      amount: '1234.56',
      expense_date: new Date(),
      created_by: createdBy,
    },
  })
  return id
}

export async function deleteCommunity(communityId: string): Promise<void> {
  await admin.communities.delete({ where: { id: communityId } })
}

// ---------------------------------------------------------------------------
// Lectura de estado, para afirmar
// ---------------------------------------------------------------------------

/**
 * Lee sesiones desde el lado privilegiado.
 *
 * Necesario porque `sessions_own` exige `user_id = app_current_user_id()`. Una
 * lectura con `prisma` sin contexto devuelve `[]` siempre, y un test que
 * espera encontrar sesiones fallaria sin decir por que: pareceria que la
 * aplicacion no las guarda, cuando lo que ocurre es que la lectura estaba mal.
 */
export async function readSessions(userId: string) {
  return admin.sessions.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'asc' },
  })
}

/** Resumen de un usuario sin `password_hash`, para no filtrarla en un assert. */
export async function readUserSafe(userId: string) {
  return admin.users.findUnique({
    where: { id: userId },
    select: { id: true, email: true, full_name: true, global_role: true, status: true, deleted_at: true },
  })
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

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
 * Express envia varios `Set-Cookie` en cabeceras separadas, pero los tipos de
 * supertest lo tipan como un unico string. Esta funcion normaliza ambas formas.
 */
export function allSetCookies(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie']
  if (Array.isArray(raw)) return raw.join(' | ')
  return typeof raw === 'string' ? raw : ''
}
