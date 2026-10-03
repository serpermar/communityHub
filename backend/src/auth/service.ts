// ---------------------------------------------------------------------------
// Servicio de autenticacion.
//
// Aqui vive la logica de negocio: quien puede entrar, cuando caduca una sesion,
// que pasa cuando llega un refresh token robado. Los controllers solo reparen
// peticiones y los repositorios solo ejecutan SQL.
//
// Regla que atraviesa todo el archivo: el servicio NUNCA decide con informacion
// que venga del cliente sin comprobarla. El `communityId` de una peticion se
// valida contra la pertenencia real del usuario antes de usarse, nunca se
// acepta tal cual.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { session_status } from '@prisma/client'
import { withContext } from '../context.js'
import { env } from '../config/env.js'
import {
  conflict,
  invalidCredentials,
  notFound,
  tokenExpired,
  tokenRevoked,
  unauthorized,
} from '../http/errors.js'
import { equalizeTiming, hashPassword, verifyPassword } from './password.js'
import { generateRefreshToken, hashRefreshToken, newFamilyId, signAccessToken } from './tokens.js'
import * as repo from './repository.js'

const MS_PER_DAY = 24 * 60 * 60 * 1000

export type PublicUser = {
  id: string
  email: string
  fullName: string
  phone: string | null
  avatarUrl: string | null
  globalRole: string
  emailVerifiedAt: string | null
  createdAt: string
}

export type SessionTokens = {
  accessToken: string
  expiresIn: number
  refreshToken: string
  user: PublicUser
}

export type ClientInfo = {
  ipAddress: string | null
  userAgent: string | null
}

function refreshExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + env.REFRESH_TOKEN_TTL_DAYS * MS_PER_DAY)
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function toPublicUser(row: {
  id: string
  email: string
  full_name: string
  phone: string | null
  avatar_url: string | null
  global_role: string
  email_verified_at: Date | null
  created_at: Date
}): PublicUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    avatarUrl: row.avatar_url,
    globalRole: row.global_role,
    emailVerifiedAt: row.email_verified_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

/**
 * Crear una cuenta.
 *
 * No se crea sesion: el usuario entra con su contrasena, lo que de paso
 * comprueba que el hash se guardo bien y que el argon2 verifica contra el.
 *
 * No se comprueba antes de insertar si el email ya existe, porque a esta altura
 * no hay contexto de RLS y la politica `users_select_self` devolveria cero
 * filas siempre. Se inserta y se traduce el conflicto de clave unica, que es
 * atomico y no deja la carrera que deja un SELECT seguido de INSERT.
 *
 * Aqui si se distingue el email duplicado del resto de errores (409
 * EMAIL_TAKEN), a diferencia del login: quien se registra conoce su propio email
 * y necesita saber que esta repetido.
 */
export async function register(input: {
  email: string
  password: string
  fullName: string
  phone?: string
}): Promise<{ user: Pick<PublicUser, 'id' | 'email' | 'fullName'>; message: string }> {
  const email = normalizeEmail(input.email)
  const passwordHash = await hashPassword(input.password)
  const id = randomUUID()

  try {
    // El contexto es el id DEL USUARIO QUE SE ESTA CREANDO, no null.
    //
    // No es un detalle menor ni un atajo: con `userId: null` el registro falla
    // con 42501 "new row violates row-level security policy for table users",
    // aunque `users_insert_public` sea `with check (true)` y el INSERT sea
    // permitido. La razon es que la escritura de Prisma comprueba la politica de
    // SELECT sobre la fila afectada, y `users_select_self` exige
    // `id = app_current_user_id()`. Con el contexto vacio, la fila recien creada
    // no es visible ni para si misma y la operacion se rechaza.
    //
    // Poner el id aqui es ademas lo correcto por si mismo: al finishing de
    // registrarse uno es el propio usuario, y `users_select_self` existe para
    // permitirle leer su fila.
    const row = await withContext({ userId: id, communityId: null }, (tx) =>
      repo.createUser(tx, {
        id,
        email,
        passwordHash,
        fullName: input.fullName.trim(),
        phone: input.phone?.trim() || null,
      }),
    )

    return {
      user: { id: row.id, email: row.email, fullName: row.full_name },
      message: 'Cuenta creada. Ya puedes entrar.',
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw conflict('EMAIL_TAKEN', 'Ya existe una cuenta con ese correo.')
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/**
 * Verificar credenciales y emitir sesion.
 *
 * Tres caminos, todos terminan en el mismo error 401 INVALID_CREDENTIALS:
 *
 *   email inexistente      -> se verifica argon2 contra un hash senuelo y 401
 *   cuenta borrada o baja  -> se verifica argon2 contra un hash senuelo y 401
 *   contrasena incorrecta  -> se verifica argon2 de verdad y 401
 *
 * El hash senuelo en los dos primeros casos no es decoracion: sin el, el tiempo
 * de respuesta delata que accounts existen. Es la unica proteccion posible,
 * porque el mensaje de error ya es identico.
 */
export async function login(input: { email: string; password: string } & ClientInfo): Promise<SessionTokens> {
  const email = normalizeEmail(input.email)

  // Sin contexto de RLS todavia: es exactamente el punto ciego que cubren las
  // funciones SECURITY DEFINER.
  const row = await withContext({ userId: null, communityId: null }, (tx) =>
    repo.findUserByEmailForAuth(tx, email),
  )

  if (!row) {
    await equalizeTiming(input.password)
    throw invalidCredentials()
  }

  const usable = row.deleted_at === null && row.status === 'ACTIVE'

  // La cuenta existe, asi que se verifica de verdad. El resultado se descarta
  // para una cuenta no utilizable, pero el trabajo se hace igual y por eso el
  // tiempo de respuesta es el mismo en los tres caminos.
  const passwordOk = await verifyPassword(row.password_hash, input.password)

  if (!usable || !passwordOk) {
    throw invalidCredentials()
  }

  const refreshToken = generateRefreshToken()
  const sessionId = randomUUID()
  const familyId = newFamilyId()

  const created = await withContext({ userId: row.id, communityId: null }, async (tx) => {
    await repo.insertSession(tx, {
      id: sessionId,
      userId: row.id,
      familyId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshExpiry(),
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    })
    await repo.touchLastLogin(tx, row.id)
    return repo.findUserById(tx, row.id)
  })

  if (!created) {
    // Solo posible si RLS denyase la lectura del propio usuario, lo que
    // significa que el contexto no se aplico. Es un fallo de infraestructura y
    // no un error de credenciales.
    throw unauthorized('No se ha podido completar el inicio de sesión.')
  }

  return {
    accessToken: signAccessToken({ userId: row.id, role: row.global_role, sessionId }),
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    refreshToken,
    user: toPublicUser(created),
  }
}

// ---------------------------------------------------------------------------
// Refresh con rotacion y deteccion de robo
// ---------------------------------------------------------------------------

/**
 * Renovar la sesion.
 *
 * La rotacion es la parte que no es trivial. Cada refresh emite un token nuevo y
 * revoca el anterior. Si un token ya revocado vuelve a aparecer, significa que
 * hay dos parties con el mismo token: la victima y un ladron. No se puede
 * saber cual es cual, asi que se revoca la FAMILIA entera. La victima pierde la
 * sesion y tiene que entrar otra vez, que es molesto; la alternativa es dejar
 * que uno de los dos la conserve, y ese puede ser el ladron.
 *
 * `family_id` no cambia al rotar: toda la cadena de un login comparte familia.
 * Solo se genera uno nuevo al hacer login de verdad.
 */
export async function refresh(input: { refreshToken: string } & ClientInfo): Promise<SessionTokens> {
  const tokenHash = hashRefreshToken(input.refreshToken)

  const existing = await withContext({ userId: null, communityId: null }, (tx) =>
    repo.findSessionByTokenHash(tx, tokenHash),
  )

  // Token desconocido: se limpia la cookie y listo. No se distingue de un token
  // revocado a proposito, para no darle informacion a quien lo prueba.
  if (!existing) {
    throw tokenRevoked()
  }

  if (existing.status === session_status.REVOKED) {
    await withContext({ userId: existing.user_id, communityId: null }, (tx) =>
      repo.revokeSessionFamily(tx, existing.family_id),
    )
    throw tokenRevoked()
  }

  if (existing.expires_at.getTime() <= Date.now()) {
    throw tokenExpired()
  }

  const nextRefreshToken = generateRefreshToken()
  const nextSessionId = randomUUID()

  const result = await withContext({ userId: existing.user_id, communityId: null }, async (tx) => {
    await repo.insertSession(tx, {
      id: nextSessionId,
      userId: existing.user_id,
      familyId: existing.family_id,
      tokenHash: hashRefreshToken(nextRefreshToken),
      expiresAt: refreshExpiry(),
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    })
    await repo.revokeSessionAsReplacedBy(tx, existing.id, nextSessionId)
    return repo.findUserById(tx, existing.user_id)
  })

  if (!result) {
    throw unauthorized('No se ha podido renovar la sesión.')
  }

  return {
    accessToken: signAccessToken({
      userId: existing.user_id,
      role: result.global_role,
      sessionId: nextSessionId,
    }),
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: nextRefreshToken,
    user: toPublicUser(result),
  }
}

// ---------------------------------------------------------------------------
// Logout y gestion de sesiones
// ---------------------------------------------------------------------------

/**
 * Cerrar la sesion actual.
 *
 * Revoca la sesion, y con ella el access token: el `ver` del JWT apunta a una
 * sesion que ya no esta ACTIVE, asi que la siguiente peticion da 401 aunque el
 * token no haya expirado. Es lo que espera alguien al pulsar "salir".
 */
export async function logout(input: { userId: string; sessionId: string }): Promise<void> {
  await withContext({ userId: input.userId, communityId: null }, (tx) =>
    repo.revokeSession(tx, input.sessionId),
  )
}

export async function listSessions(input: { userId: string; currentSessionId: string }) {
  const rows = await withContext({ userId: input.userId, communityId: null }, (tx) =>
    repo.listActiveSessions(tx, input.userId),
  )

  return rows.map((row) => ({
    id: row.id,
    // Marca la sesion con la que ha llegado esta peticion, para que la interfaz
    // pueda indicarla y no ofrecer "cerrar esta sesion" sobre ella misma.
    current: row.id === input.currentSessionId,
    familyId: row.family_id,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
  }))
}

/**
 * Revocar una sesion concreta del usuario, desde la pantalla de sesiones.
 *
 * La pertenencia la garantiza `sessions_own`. Una sesion ajena no es un 403 con
 * detalle: afectaria a cero filas y se responde 404, para no confirmar que ese
 * id existe.
 */
export async function revokeSessionById(input: { userId: string; sessionId: string }): Promise<void> {
  const revoked = await withContext({ userId: input.userId, communityId: null }, (tx) =>
    repo.revokeSession(tx, input.sessionId),
  )

  if (revoked === 0) {
    throw notFound('Esa sesión no existe.')
  }
}

// ---------------------------------------------------------------------------
// Usuario actual
// ---------------------------------------------------------------------------

/**
 * Usuario de la peticion.
 *
 * Se lee dentro del contexto de RLS y la politica `users_select_self` solo deja
 * ver la fila propia. Si algun dia se rompe esa politica, este endpoint devuelve
 * un 404 en vez de datos de otro, y el fallo es visible.
 */
export async function getMe(userId: string): Promise<PublicUser> {
  const row = await withContext({ userId, communityId: null }, (tx) => repo.findUserById(tx, userId))

  if (!row) {
    throw notFound('Usuario no encontrado.')
  }

  return toPublicUser(row)
}