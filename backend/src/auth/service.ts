// ---------------------------------------------------------------------------
// Servicio de autenticacion.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { Prisma, session_status } from '@prisma/client'
import { withContext } from '../context.js'
import { env } from '../config/env.js'
import {
  conflict,
  invalidCredentials,
  invalidCurrentPassword,
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

export async function login(
  input: { email: string; password: string } & ClientInfo,
): Promise<SessionTokens> {
  const email = normalizeEmail(input.email)

  const row = await withContext({ userId: null, communityId: null }, (tx) =>
    repo.findUserByEmailForAuth(tx, email),
  )

  if (!row) {
    await equalizeTiming(input.password)
    throw invalidCredentials()
  }

  const usable = row.deleted_at === null && row.status === 'ACTIVE'
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

export async function refresh(
  input: { refreshToken: string } & ClientInfo,
): Promise<SessionTokens> {
  const tokenHash = hashRefreshToken(input.refreshToken)

  const existing = await withContext({ userId: null, communityId: null }, (tx) =>
    repo.findSessionByTokenHash(tx, tokenHash),
  )

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
    current: row.id === input.currentSessionId,
    familyId: row.family_id,
    expiresAt: row.expires_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
  }))
}

export async function revokeSessionById(input: {
  userId: string
  sessionId: string
}): Promise<void> {
  const revoked = await withContext({ userId: input.userId, communityId: null }, (tx) =>
    repo.revokeSession(tx, input.sessionId),
  )

  if (revoked === 0) {
    throw notFound('Esa sesión no existe.')
  }
}

export async function revokeOtherSessions(input: {
  userId: string
  sessionId: string
}): Promise<number> {
  return withContext({ userId: input.userId, communityId: null }, (tx) =>
    repo.revokeOtherSessions(tx, input.userId, input.sessionId),
  )
}

// ---------------------------------------------------------------------------
// Usuario actual
// ---------------------------------------------------------------------------

export async function getMe(userId: string): Promise<PublicUser> {
  const row = await withContext({ userId, communityId: null }, (tx) =>
    repo.findUserById(tx, userId),
  )

  if (!row) {
    throw notFound('Usuario no encontrado.')
  }

  return toPublicUser(row)
}

// ---------------------------------------------------------------------------
// Edicion del perfil propio
// ---------------------------------------------------------------------------

export async function updateProfile(
  userId: string,
  input: { fullName: string; phone?: string },
): Promise<PublicUser> {
  const row = await withContext({ userId, communityId: null }, (tx) =>
    repo.updateProfile(tx, userId, {
      fullName: input.fullName.trim(),
      phone: input.phone?.trim() || null,
    }),
  )

  if (!row) {
    throw notFound('Usuario no encontrado.')
  }

  return toPublicUser(row)
}

export async function changePassword(input: {
  userId: string
  sessionId: string
  currentPassword: string
  newPassword: string
}): Promise<void> {
  const row = await withContext({ userId: input.userId, communityId: null }, (tx) =>
    repo.findUserPasswordHash(tx, input.userId),
  )

  if (!row) {
    throw notFound('Usuario no encontrado.')
  }

  const currentOk = await verifyPassword(row.password_hash, input.currentPassword)
  if (!currentOk) {
    throw invalidCurrentPassword()
  }

  const passwordHash = await hashPassword(input.newPassword)

  await withContext({ userId: input.userId, communityId: null }, async (tx) => {
    await repo.updatePasswordHash(tx, input.userId, passwordHash)
    await repo.revokeOtherSessions(tx, input.userId, input.sessionId)
  })
}

export async function uploadAvatar(
  userId: string,
  file: { buffer: Buffer; mimetype: string },
): Promise<PublicUser> {
  const { getStorageGateway } = await import('../documents/storage/index.js')
  const gateway = await getStorageGateway()
  const ext = file.mimetype.split('/')[1] || 'jpg'
  const path = `avatars/${userId}/${randomUUID()}.${ext}`
  await gateway.upload(path, file.buffer, file.mimetype)
  const url = await gateway.signedUrl(path, 60 * 60 * 24 * 7)

  const row = await withContext({ userId, communityId: null }, (tx) =>
    repo.updateAvatar(tx, userId, url),
  )

  if (!row) {
    throw notFound('Usuario no encontrado.')
  }

  return toPublicUser(row)
}

export async function deleteAvatar(userId: string): Promise<PublicUser> {
  const row = await withContext({ userId, communityId: null }, (tx) =>
    repo.updateAvatar(tx, userId, null),
  )

  if (!row) {
    throw notFound('Usuario no encontrado.')
  }

  return toPublicUser(row)
}

// ---------------------------------------------------------------------------
// Exportacion de datos (RGPD)
// ---------------------------------------------------------------------------

/**
 * Exporta todos los datos personales del usuario.
 *
 * Ahora que la recursión de `document_acl` está resuelta en SQL (con la función
 * `app_user_can_view_document_acl`), todas las consultas pueden ir dentro de
 * `withContext` con el rol `app_runtime`. No hace falta el cliente `admin` y se
 * mantiene la regla de no importar `db-admin.ts` desde código de producto.
 */
export async function exportUserData(userId: string) {
  return withContext({ userId, communityId: null }, async (tx) => {
    // 1. Perfil
    const user = await tx.users.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        full_name: true,
        phone: true,
        global_role: true,
        email_verified_at: true,
        created_at: true,
        updated_at: true,
      },
    })

    if (!user) {
      throw new Error('Usuario no encontrado')
    }

    // 2. Membresías
    const membershipsRaw = await tx.communityMembers.findMany({
      where: { user_id: userId },
      select: {
        community_id: true,
        role: true,
        status: true,
        unit_number: true,
        joined_at: true,
      },
    })

    const communityIds = membershipsRaw.map((m) => m.community_id).filter(Boolean)
    const communities = communityIds.length
      ? await tx.communities.findMany({
          where: { id: { in: communityIds } },
          select: { id: true, name: true, city: true },
        })
      : []

    const communityMap = new Map(communities.map((c) => [c.id, c]))
    const memberships = membershipsRaw.map((m) => ({
      role: m.role,
      status: m.status,
      unit_number: m.unit_number,
      joined_at: m.joined_at,
      community: communityMap.get(m.community_id) ?? null,
    }))

    // 3. Incidencias
    const incidents = await tx.incidents.findMany({
      where: { reporter_id: userId },
      select: {
        reference_code: true,
        title: true,
        description: true,
        category: true,
        priority: true,
        status: true,
        created_at: true,
      },
    })

    // 4. Reservas
    const reservationsRaw = await tx.reservations.findMany({
      where: { user_id: userId },
      select: { common_area_id: true, starts_at: true, ends_at: true, status: true },
    })

    const areaIds = [...new Set(reservationsRaw.map((r) => r.common_area_id).filter(Boolean))]
    const areas = areaIds.length
      ? await tx.commonAreas.findMany({
          where: { id: { in: areaIds } },
          select: { id: true, name: true },
        })
      : []

    const areaMap = new Map(areas.map((a) => [a.id, a]))
    const reservations = reservationsRaw.map((r) => ({
      starts_at: r.starts_at,
      ends_at: r.ends_at,
      status: r.status,
      common_area: areaMap.get(r.common_area_id) ?? null,
    }))

    // 5. Votos emitidos
    const votesRaw = await tx.voteResponses.findMany({
      where: { user_id: userId },
      select: { option_id: true, created_at: true },
    })

    const optionIds = [...new Set(votesRaw.map((v) => v.option_id).filter(Boolean))]
    const options = optionIds.length
      ? await tx.voteOptions.findMany({
          where: { id: { in: optionIds } },
          select: { id: true, label: true, vote_id: true },
        })
      : []

    const optionMap = new Map(options.map((o) => [o.id, o]))
    const voteIds = [...new Set(options.map((o) => o.vote_id).filter(Boolean))]
    const voteTitles = voteIds.length
      ? await tx.votes.findMany({
          where: { id: { in: voteIds } },
          select: { id: true, title: true },
        })
      : []

    const voteTitleMap = new Map(voteTitles.map((v) => [v.id, v.title]))
    const votes = votesRaw.map((v) => {
      const option = optionMap.get(v.option_id)
      return {
        created_at: v.created_at,
        option_label: option?.label ?? null,
        vote_title: option ? (voteTitleMap.get(option.vote_id) ?? null) : null,
      }
    })

    // 6. Zonas comunes creadas
    const commonAreas = await tx.commonAreas.findMany({
      where: { created_by: userId },
      select: { name: true, type: true, created_at: true },
    })

    // 7. Avisos creados
    const announcements = await tx.announcements.findMany({
      where: { author_id: userId },
      select: { title: true, type: true, publish_at: true },
    })

    // 8. Documentos subidos (ahora con RLS, sin recursión gracias al fix de SQL)
    const documents = await tx.documents.findMany({
      where: { uploaded_by: userId },
      select: { title: true, category: true, created_at: true },
    })

    // 9. Gastos creados
    const expenses = await tx.expenses.findMany({
      where: { created_by: userId },
      select: { concept: true, amount: true, expense_date: true },
    })

    // 10. Facturas creadas
    const invoices = await tx.invoices.findMany({
      where: { created_by: userId },
      select: { number: true, amount: true, status: true, issue_date: true },
    })

    // 11. Votaciones creadas
    const createdVotes = await tx.votes.findMany({
      where: { created_by: userId },
      select: { title: true, status: true, created_at: true },
    })

    return {
      exportedAt: new Date().toISOString(),
      profile: user,
      memberships,
      activity: {
        incidents,
        reservations,
        votes,
        commonAreas,
        announcements,
        documents,
        expenses,
        invoices,
        createdVotes,
      },
    }
  })
}
