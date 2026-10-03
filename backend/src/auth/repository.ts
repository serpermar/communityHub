// ---------------------------------------------------------------------------
// Acceso a datos de la capa de autenticacion.
//
// Es el unico sitio del modulo que escribe SQL. El servicio decide; esta capa
// ejecuta. Todas las funciones reciben el cliente de transaccion, nunca el
// singleton: por construccion no se puede leer nada fuera del contexto de RLS.
//
// Dos de las funciones no pueden usar Prisma directamente y van por
// `SECURITY DEFINER` de 02b_auth.sql, por el punto ciego del login descrito en
// la spec 01, seccion 4: antes de autenticar no hay `app.current_user_id`, asi
// que las politicas de RLS devolverian cero filas siempre.
// ---------------------------------------------------------------------------

import type { Prisma } from '@prisma/client'
import { session_status } from '@prisma/client'

type Tx = Prisma.TransactionClient

export type AuthUserRow = {
  id: string
  password_hash: string
  full_name: string
  global_role: string
  status: string
  deleted_at: Date | null
  email_verified_at: Date | null
}

export type AuthSessionRow = {
  id: string
  user_id: string
  family_id: string
  status: string
  expires_at: Date
  revoked_at: Date | null
  replaced_by: string | null
  created_at: Date
}

/**
 * Buscar usuario por email para el login.
 *
 * Va contra `app_auth_find_user_by_email` porque todavia no se sabe quien es el
 * usuario: es precisamente lo que se va a demostrar. Devuelve el hash porque
 * verificar argon2 lo necesita; ver la advertencia de 02b_auth.sql sobre por que
 * eso es inevitable y por que el rol `postgres` seria mucho peor.
 *
 * El indice `users_email_lower_uidx` esta sobre `lower(email)`, asi que la
 * busqueda es case-insensitive sin un `lower()` en tiempo de consulta.
 */
export async function findUserByEmailForAuth(tx: Tx, email: string): Promise<AuthUserRow | null> {
  const rows = await tx.$queryRaw<AuthUserRow[]>`
    select * from app_auth_find_user_by_email(${email})
  `
  return rows[0] ?? null
}

/** Buscar sesion por hash de refresh token. Mismo punto ciego: aun no hay contexto. */
export async function findSessionByTokenHash(tx: Tx, tokenHash: string): Promise<AuthSessionRow | null> {
  const rows = await tx.$queryRaw<AuthSessionRow[]>`
    select * from app_auth_find_session_by_hash(${tokenHash})
  `
  return rows[0] ?? null
}

/** Revoca la familia entera de sesiones. Devuelve cuantas revoco. */
export async function revokeSessionFamily(tx: Tx, familyId: string): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ app_auth_revoke_family: number }>>`
    select app_auth_revoke_family(${familyId}::uuid) as app_auth_revoke_family
  `
  return rows[0]?.app_auth_revoke_family ?? 0
}

export async function createUser(
  tx: Tx,
  input: { id: string; email: string; passwordHash: string; fullName: string; phone?: string | null },
) {
  return tx.users.create({
    data: {
      id: input.id,
      email: input.email,
      password_hash: input.passwordHash,
      full_name: input.fullName,
      phone: input.phone ?? null,
    },
    select: { id: true, email: true, full_name: true },
  })
}

export async function touchLastLogin(tx: Tx, userId: string): Promise<void> {
  await tx.users.update({ where: { id: userId }, data: { last_login_at: new Date() } })
}

/** Usuario leido ya dentro del contexto de RLS: solo devuelve la fila propia. */
export async function findUserById(tx: Tx, userId: string) {
  return tx.users.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      full_name: true,
      phone: true,
      avatar_url: true,
      global_role: true,
      status: true,
      email_verified_at: true,
      last_login_at: true,
      created_at: true,
    },
  })
}

export async function insertSession(
  tx: Tx,
  input: {
    id: string
    userId: string
    familyId: string
    tokenHash: string
    expiresAt: Date
    userAgent: string | null
    ipAddress: string | null
  },
): Promise<void> {
  await tx.sessions.create({
    data: {
      id: input.id,
      user_id: input.userId,
      family_id: input.familyId,
      token_hash: input.tokenHash,
      status: session_status.ACTIVE,
      expires_at: input.expiresAt,
      user_agent: input.userAgent,
      ip_address: input.ipAddress,
    },
  })
}

/**
 * Rota el refresh token: el viejo queda revocado y apuntando al nuevo.
 *
 * `replaced_by` convierte la rotacion en una cadena auditable (A -> B -> C), y a
 * simple vista se ve que token se uso primero cuando hay robo.
 *
 * Va en la misma transaccion que el INSERT del nuevo, porque un fallo entre
 * ambos dejaria al usuario sin refresh vigente.
 */
export async function revokeSessionAsReplacedBy(tx: Tx, oldSessionId: string, newSessionId: string): Promise<void> {
  await tx.sessions.update({
    where: { id: oldSessionId },
    data: {
      status: session_status.REVOKED,
      revoked_at: new Date(),
      replaced_by: newSessionId,
    },
  })
}

/**
 * Revocar una sesion concreta.
 *
 * `updateMany` y no `update`: la politica `sessions_own` ya impide tocar sesiones
 * ajenas, asi que actualizar una que no es propia afecta a cero filas. Con
 * `update` Prisma lanzaria P2025 y eso se traduciria en un 500 para un recurso
 * que sencillamente no es suyo, que ademas es un oraculo de existencia.
 */
export async function revokeSession(tx: Tx, sessionId: string): Promise<number> {
  const result = await tx.sessions.updateMany({
    where: { id: sessionId, status: session_status.ACTIVE },
    data: { status: session_status.REVOKED, revoked_at: new Date() },
  })
  return result.count
}

export async function listActiveSessions(tx: Tx, userId: string) {
  return tx.sessions.findMany({
    where: { user_id: userId, status: session_status.ACTIVE, expires_at: { gt: new Date() } },
    select: {
      id: true,
      family_id: true,
      expires_at: true,
      created_at: true,
      last_used_at: true,
      user_agent: true,
      ip_address: true,
    },
    orderBy: { created_at: 'desc' },
  })
}

/** Estado de una sesion concreta, para validar el `ver` del access token. */
export async function findSessionStatus(tx: Tx, sessionId: string) {
  return tx.sessions.findUnique({
    where: { id: sessionId },
    select: { id: true, user_id: true, status: true, expires_at: true },
  })
}