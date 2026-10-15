// ---------------------------------------------------------------------------
// Dashboard por API (spec 13 §12).
//
// Los fixtures se siembran con `admin` (privilegio) y se afirma por la API, la
// regla de siempre (sembrar con privilegio, afirmar con restriccion). Ninguna
// peticion sale a la red: el dashboard no tiene proveedores externos.
//
// Lo que SOLO se puede demostrar aqui, y no en los unitarios:
//
//   1. CONTAR NO ES LEER (DSH-2): un NEIGHBOR recibe los recuentos de TODA la
//      comunidad, no solo los de sus incidencias. Eso solo se ve contra el
//      motor, porque la funcion corre como su propietario y salta la RLS por
//      filas (activa pero no forzada).
//   2. La asimetria por rol (DSH-3): `finance` es `null` salvo para ADMIN.
//   3. El aislamiento entre comunidades (C-8) vale para el dashboard.
//   4. El dashboard NO escribe: ni `audit_logs` ni `notifications` (criterio
//      transversal de §12).
//
// El teardown borra la comunidad (cascade) y los usuarios; `audit_logs` se
// purga antes por el mismo rodeo que el test de integraciones (trigger
// append-only + FK on delete set null).
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import type {
  incident_category,
  incident_priority,
  incident_status,
  invoice_status,
  reservation_status,
  vote_status,
} from '@prisma/client'
import { admin } from '../db-admin.js'
import { app, createUser, deleteCommunity, deleteUser, makeCommunity, makeMember, type TestUser } from './helpers.js'

const V1 = '/api/v1'

const usuarios: string[] = []
const comunidades: string[] = []

/** Milisegundos de `n` dias, para fechas relativas a "ahora". */
function dias(n: number): Date {
  return new Date(Date.now() + n * 86_400_000)
}

async function purgarAuditoria(where: { communityId?: string; actorId?: string }): Promise<void> {
  const columna = where.communityId ? 'community_id' : 'actor_id'
  const valor = where.communityId ?? where.actorId
  if (!valor) return

  await admin.$executeRawUnsafe('alter table audit_logs disable trigger audit_logs_no_update')
  try {
    await admin.$executeRawUnsafe(`delete from audit_logs where ${columna} = $1::uuid`, valor)
  } finally {
    await admin.$executeRawUnsafe('alter table audit_logs enable trigger audit_logs_no_update')
  }
}

afterEach(async () => {
  while (comunidades.length > 0) {
    const id = comunidades.pop()!
    await purgarAuditoria({ communityId: id }).catch(() => undefined)
    await deleteCommunity(id).catch(() => undefined)
  }
})

afterAll(async () => {
  while (usuarios.length > 0) {
    const id = usuarios.pop()!
    await purgarAuditoria({ actorId: id }).catch(() => undefined)
    await deleteUser(id).catch(() => undefined)
  }
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function nuevoUsuario(fullName: string): Promise<TestUser> {
  const user = await createUser({ fullName })
  usuarios.push(user.id)
  return user
}

async function nuevaComunidad(nombre = 'Comunidad Dashboard'): Promise<string> {
  const id = await makeCommunity(nombre)
  comunidades.push(id)
  return id
}

async function tokenDe(user: TestUser): Promise<string> {
  const res = await request(app()).post(`${V1}/auth/login`).send({ email: user.email, password: user.password })
  expect(res.status).toBe(200)
  return `Bearer ${res.body.data.accessToken}`
}

type Actor = TestUser & { token: string }

async function miembro(comunidad: string, role: 'NEIGHBOR' | 'PROVIDER' | 'ADMIN' | 'PRESIDENT'): Promise<Actor> {
  const user = await nuevoUsuario(`Actor ${role}`)
  await makeMember(user.id, comunidad, role)
  return { ...user, token: await tokenDe(user) }
}

async function outsider(): Promise<Actor> {
  const user = await nuevoUsuario('De fuera')
  return { ...user, token: await tokenDe(user) }
}

function dashboard(c: string, a?: Actor, qs = ''): request.Test {
  const req = request(app()).get(`${V1}/communities/${c}/dashboard${qs}`)
  return a ? req.set('Authorization', a.token) : req
}

async function seedIncident(
  communityId: string,
  reporterId: string,
  data: {
    status?: incident_status
    priority?: incident_priority
    category?: incident_category
    assignedToId?: string | null
    deletedAt?: Date | null
    createdAt?: Date
  } = {},
): Promise<string> {
  const id = randomUUID()
  await admin.incidents.create({
    data: {
      id,
      community_id: communityId,
      title: 'Incidencia de prueba',
      description: 'Descripción de prueba.',
      category: data.category ?? 'OTHER',
      priority: data.priority ?? 'LOW',
      status: data.status ?? 'OPEN',
      reporter_id: reporterId,
      assigned_to_id: data.assignedToId ?? null,
      reference_code: randomUUID().slice(0, 8),
      deleted_at: data.deletedAt ?? null,
      created_at: data.createdAt ?? new Date(),
    },
  })
  return id
}

async function seedArea(communityId: string, name = 'Salón de actos'): Promise<string> {
  const id = randomUUID()
  await admin.commonAreas.create({
    data: { id, community_id: communityId, name, type: 'COMMUNITY_ROOM' },
  })
  return id
}

async function seedReservation(
  communityId: string,
  areaId: string,
  userId: string,
  startsAt: Date,
  status: reservation_status = 'CONFIRMED',
): Promise<string> {
  const id = randomUUID()
  await admin.reservations.create({
    data: {
      id,
      community_id: communityId,
      common_area_id: areaId,
      user_id: userId,
      starts_at: startsAt,
      ends_at: new Date(startsAt.getTime() + 3_600_000),
      status,
      notes: 'nota privada que NO debe salir',
    },
  })
  return id
}

async function seedAnnouncement(
  communityId: string,
  authorId: string,
  data: { title?: string; publishAt?: Date; expiresAt?: Date | null; deletedAt?: Date | null; isPinned?: boolean } = {},
): Promise<string> {
  const id = randomUUID()
  await admin.announcements.create({
    data: {
      id,
      community_id: communityId,
      title: data.title ?? 'Aviso',
      body: 'Cuerpo del aviso.',
      author_id: authorId,
      publish_at: data.publishAt ?? dias(-1),
      expires_at: data.expiresAt ?? null,
      deleted_at: data.deletedAt ?? null,
      is_pinned: data.isPinned ?? false,
    },
  })
  return id
}

async function seedVote(
  communityId: string,
  createdById: string,
  data: { title?: string; status?: vote_status; startsAt?: Date; endsAt: Date; deletedAt?: Date | null },
): Promise<string> {
  const id = randomUUID()
  await admin.votes.create({
    data: {
      id,
      community_id: communityId,
      title: data.title ?? 'Votación',
      question: '¿Sí o no?',
      status: data.status ?? 'OPEN',
      starts_at: data.startsAt ?? dias(-1),
      ends_at: data.endsAt,
      created_by: createdById,
      deleted_at: data.deletedAt ?? null,
    },
  })
  return id
}

async function seedExpense(communityId: string, createdBy: string, amount: string, expenseDate: Date): Promise<string> {
  const id = randomUUID()
  await admin.expenses.create({
    data: {
      id,
      community_id: communityId,
      concept: 'Gasto de prueba',
      category: 'MAINTENANCE',
      amount,
      expense_date: expenseDate,
      created_by: createdBy,
    },
  })
  return id
}

async function seedInvoice(
  communityId: string,
  createdBy: string,
  amount: string,
  dueDate: Date,
  status: invoice_status = 'PENDING',
): Promise<string> {
  const id = randomUUID()
  await admin.invoices.create({
    data: {
      id,
      community_id: communityId,
      number: `INV-${randomUUID().slice(0, 8)}`,
      amount,
      issue_date: dias(-30),
      due_date: dueDate,
      status,
      created_by: createdBy,
    },
  })
  return id
}

// ---------------------------------------------------------------------------
// 1. Estructura, autenticacion y aislamiento
// ---------------------------------------------------------------------------

describe('GET /communities/:id/dashboard', () => {
  it('devuelve el DashboardView completo para un miembro', async () => {
    const c = await nuevaComunidad()
    const vecino = await miembro(c, 'NEIGHBOR')

    const res = await dashboard(c, vecino)

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      community: { id: c, neighborCount: 1, memberCount: 1 },
      incidents: { open: 0, inProgress: 0, pending: 0, critical: 0, byStatus: [], byCategory: [] },
      reservations: { upcomingCount: 0, upcoming: [], byMonth: [] },
      announcements: { latest: [] },
      votes: { openCount: 0, open: [] },
      finance: null,
    })
    expect(typeof res.body.data.generatedAt).toBe('string')
    expect(res.body.data.period).toMatchObject({ from: expect.any(String), to: expect.any(String) })
  })

  it('sin token da 401', async () => {
    const c = await nuevaComunidad()
    expect((await dashboard(c)).status).toBe(401)
  })

  it('a un miembro de otra comunidad le da 403', async () => {
    const c = await nuevaComunidad()
    const deFuera = await outsider()
    expect((await dashboard(c, deFuera)).status).toBe(403)
  })

  it('una comunidad inexistente da 403 (C-8), no 404', async () => {
    const vecino = await miembro(await nuevaComunidad(), 'NEIGHBOR')
    expect((await dashboard(randomUUID(), vecino)).status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// 2. Recuentos de incidencias (DSH-7)
// ---------------------------------------------------------------------------

describe('incidencias', () => {
  it('cuenta abiertas, en curso, pendientes y criticas segun su definicion', async () => {
    const c = await nuevaComunidad()
    const admin_ = await miembro(c, 'ADMIN')

    await seedIncident(c, admin_.id, { status: 'OPEN', priority: 'HIGH' })
    await seedIncident(c, admin_.id, { status: 'OPEN', priority: 'LOW', assignedToId: admin_.id })
    await seedIncident(c, admin_.id, { status: 'IN_PROGRESS', priority: 'MEDIUM', assignedToId: admin_.id })
    await seedIncident(c, admin_.id, { status: 'RESOLVED', priority: 'HIGH' })
    await seedIncident(c, admin_.id, { status: 'CANCELLED', priority: 'LOW' })
    await seedIncident(c, admin_.id, { status: 'OPEN', priority: 'CRITICAL' })
    // Borrada: no cuenta en ningun recuento.
    await seedIncident(c, admin_.id, { status: 'OPEN', priority: 'HIGH', deletedAt: dias(-1) })

    const res = await dashboard(c, admin_)

    expect(res.status).toBe(200)
    expect(res.body.data.incidents).toMatchObject({ open: 3, inProgress: 1, pending: 2, critical: 1 })
  })

  it('un NEIGHBOR ve los recuentos de TODA la comunidad (DSH-2: contar no es leer)', async () => {
    const c = await nuevaComunidad()
    const vecino = await miembro(c, 'NEIGHBOR')
    const otro = await nuevoUsuario('Otro vecino')
    await makeMember(otro.id, c, 'NEIGHBOR')

    // Dos incidencias de OTRO vecino: el actor no deberia ver sus filas, pero
    // SI debe contarlas.
    await seedIncident(c, otro.id, { status: 'OPEN' })
    await seedIncident(c, otro.id, { status: 'OPEN' })

    const res = await dashboard(c, vecino)

    expect(res.status).toBe(200)
    expect(res.body.data.incidents.open).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 3. Reservas proximas (DSH-9)
// ---------------------------------------------------------------------------

describe('reservas', () => {
  it('solo trae futuras confirmadas, sin notes, y cuenta el total', async () => {
    const c = await nuevaComunidad()
    const admin_ = await miembro(c, 'ADMIN')
    const area = await seedArea(c, 'Piscina')

    const futura = await seedReservation(c, area, admin_.id, dias(2), 'CONFIRMED')
    await seedReservation(c, area, admin_.id, dias(1), 'PENDING')
    await seedReservation(c, area, admin_.id, dias(-2), 'CONFIRMED') // pasada
    await seedReservation(c, area, admin_.id, dias(3), 'CANCELLED') // cancelada

    const res = await dashboard(c, admin_)

    expect(res.status).toBe(200)
    expect(res.body.data.reservations.upcomingCount).toBe(2)
    const ids = res.body.data.reservations.upcoming.map((r: { id: string }) => r.id)
    expect(ids).toContain(futura)
    expect(ids).toHaveLength(2)
    // Orden ascendente por starts_at: la de dias(1) va antes que la de dias(2).
    expect(res.body.data.reservations.upcoming[0].id).not.toBe(futura)
    // La nota privada no viaja.
    expect(res.body.data.reservations.upcoming[0]).not.toHaveProperty('notes')
    expect(res.body.data.reservations.upcoming[0].commonAreaName).toBe('Piscina')
  })
})

// ---------------------------------------------------------------------------
// 4. Ultimos avisos (DSH-10)
// ---------------------------------------------------------------------------

describe('avisos', () => {
  it('solo trae los vigentes', async () => {
    const c = await nuevaComunidad()
    const admin_ = await miembro(c, 'ADMIN')

    const vigente = await seedAnnouncement(c, admin_.id, { title: 'Vigente' })
    await seedAnnouncement(c, admin_.id, { title: 'Caducado', publishAt: dias(-10), expiresAt: dias(-1) })
    await seedAnnouncement(c, admin_.id, { title: 'Borrado', deletedAt: dias(-1) })

    const res = await dashboard(c, admin_)

    expect(res.status).toBe(200)
    expect(res.body.data.announcements.latest).toHaveLength(1)
    expect(res.body.data.announcements.latest[0]).toMatchObject({ id: vigente, title: 'Vigente' })
  })
})

// ---------------------------------------------------------------------------
// 5. Proximas votaciones (DSH-11)
// ---------------------------------------------------------------------------

describe('votaciones', () => {
  it('solo trae las abiertas no vencidas y sin recuento', async () => {
    const c = await nuevaComunidad()
    const admin_ = await miembro(c, 'ADMIN')

    const abierta = await seedVote(c, admin_.id, { title: 'Abierta', endsAt: dias(5) })
    await seedVote(c, admin_.id, { title: 'Vencida', startsAt: dias(-10), endsAt: dias(-5) })
    await seedVote(c, admin_.id, { title: 'Borrador', status: 'DRAFT', endsAt: dias(5) })

    const res = await dashboard(c, admin_)

    expect(res.status).toBe(200)
    expect(res.body.data.votes.openCount).toBe(1)
    expect(res.body.data.votes.open).toHaveLength(1)
    expect(res.body.data.votes.open[0]).toMatchObject({ id: abierta, title: 'Abierta' })
    expect(res.body.data.votes.open[0]).not.toHaveProperty('totalVotes')
  })
})

// ---------------------------------------------------------------------------
// 6. Finanzas por rol (DSH-3)
// ---------------------------------------------------------------------------

describe('finanzas', () => {
  it('para ADMIN trae las cifras del periodo', async () => {
    const c = await nuevaComunidad()
    const admin_ = await miembro(c, 'ADMIN')

    await seedExpense(c, admin_.id, '100.00', dias(-10))
    await seedExpense(c, admin_.id, '250.50', dias(-40))
    await seedInvoice(c, admin_.id, '300.00', dias(10), 'PENDING') // pendiente
    await seedInvoice(c, admin_.id, '500.00', dias(-10), 'PENDING') // vencida
    await seedInvoice(c, admin_.id, '999.00', dias(-10), 'PAID') // pagada: no cuenta como abierta

    const res = await dashboard(c, admin_)
    const finance = res.body.data.finance

    expect(res.status).toBe(200)
    expect(finance).not.toBeNull()
    expect(finance.expenseCount).toBe(2)
    expect(finance.expenseTotal).toBeCloseTo(350.5, 2)
    expect(finance.invoiceOpenAmount).toBeCloseTo(800, 2)
    expect(finance.invoicePendingCount).toBe(1)
    expect(finance.invoiceOverdueCount).toBe(1)
  })

  it('para NEIGHBOR, PRESIDENT y PROVIDER finance es null', async () => {
    const c = await nuevaComunidad()
    const vecino = await miembro(c, 'NEIGHBOR')
    const presidente = await miembro(c, 'PRESIDENT')
    const proveedor = await miembro(c, 'PROVIDER')

    for (const actor of [vecino, presidente, proveedor]) {
      const res = await dashboard(c, actor)
      expect(res.status, `para ${actor.email}`).toBe(200)
      expect(res.body.data.finance).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// 7. Series y ventana temporal (DSH-5)
// ---------------------------------------------------------------------------

describe('series y ventana', () => {
  it('las series respetan from/to y no inventan meses vacios', async () => {
    const c = await nuevaComunidad()
    const admin_ = await miembro(c, 'ADMIN')

    // Dos incidencias recientes y una historica (2020).
    await seedIncident(c, admin_.id, { status: 'OPEN' })
    await seedIncident(c, admin_.id, { status: 'RESOLVED' })
    await seedIncident(c, admin_.id, { status: 'OPEN', createdAt: new Date('2020-06-15T10:00:00Z') })

    const ventana2020 = await dashboard(c, admin_, '?from=2020-01-01&to=2020-12-31')
    const porEstado2020 = ventana2020.body.data.incidents.byStatus
    expect(porEstado2020).toEqual([{ status: 'OPEN', count: 1 }])
    expect(ventana2020.body.data.incidents.byCategory).toEqual([{ category: 'OTHER', count: 1 }])

    // El KPI `open` NO esta ventaneado: cuenta todo.
    expect(ventana2020.body.data.incidents.open).toBe(2)

    // La ventana por defecto (12 meses) deja fuera la de 2020.
    const porDefecto = await dashboard(c, admin_)
    const estados = porDefecto.body.data.incidents.byStatus
    expect(estados).toContainEqual({ status: 'OPEN', count: 1 })
    expect(estados).toContainEqual({ status: 'RESOLVED', count: 1 })
    expect(porDefecto.body.data.incidents.byCategory).toEqual([{ category: 'OTHER', count: 2 }])
  })

  it('reservations.byMonth agrupa por mes dentro de la ventana', async () => {
    const c = await nuevaComunidad()
    const admin_ = await miembro(c, 'ADMIN')
    const area = await seedArea(c)

    await seedReservation(c, area, admin_.id, new Date('2020-03-10T10:00:00Z'))
    await seedReservation(c, area, admin_.id, new Date('2020-03-20T10:00:00Z'))
    await seedReservation(c, area, admin_.id, new Date('2020-09-05T10:00:00Z'))

    const res = await dashboard(c, admin_, '?from=2020-01-01&to=2020-12-31')

    expect(res.body.data.reservations.byMonth).toEqual([
      { month: '2020-03', count: 2 },
      { month: '2020-09', count: 1 },
    ])
  })
})

// ---------------------------------------------------------------------------
// 8. Vecinos y miembros (DSH-8)
// ---------------------------------------------------------------------------

describe('vecinos y miembros', () => {
  it('neighborCount excluye al PROVIDER; memberCount lo incluye', async () => {
    const c = await nuevaComunidad()
    const admin_ = await miembro(c, 'ADMIN')
    await miembro(c, 'NEIGHBOR')
    await miembro(c, 'NEIGHBOR')
    await miembro(c, 'PRESIDENT')
    await miembro(c, 'PROVIDER') // no es un vecino

    const res = await dashboard(c, admin_)

    expect(res.status).toBe(200)
    expect(res.body.data.community.memberCount).toBe(5)
    expect(res.body.data.community.neighborCount).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// 9. Aislamiento entre comunidades (C-8)
// ---------------------------------------------------------------------------

describe('aislamiento entre comunidades', () => {
  it('los datos de B no entran en el dashboard de A', async () => {
    const a = await nuevaComunidad('Comunidad A')
    const b = await nuevaComunidad('Comunidad B')
    const admin_ = await miembro(a, 'ADMIN')

    await seedIncident(a, admin_.id, { status: 'OPEN' })
    await seedIncident(b, admin_.id, { status: 'OPEN' })
    await seedIncident(b, admin_.id, { status: 'OPEN' })

    const res = await dashboard(a, admin_)

    expect(res.status).toBe(200)
    expect(res.body.data.incidents.open).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 10. Validacion de fechas (§10.3)
// ---------------------------------------------------------------------------

describe('validacion de la ventana', () => {
  it('rechaza una fecha mal formada', async () => {
    const c = await nuevaComunidad()
    const vecino = await miembro(c, 'NEIGHBOR')

    const res = await dashboard(c, vecino, '?from=2026-1-5')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rechaza from > to', async () => {
    const c = await nuevaComunidad()
    const vecino = await miembro(c, 'NEIGHBOR')

    const res = await dashboard(c, vecino, '?from=2026-12-31&to=2026-01-01')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('rechaza un rango de mas de 24 meses', async () => {
    const c = await nuevaComunidad()
    const vecino = await miembro(c, 'NEIGHBOR')

    const res = await dashboard(c, vecino, '?from=2020-01-01&to=2023-01-01')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})

// ---------------------------------------------------------------------------
// 11. El dashboard no escribe nada
// ---------------------------------------------------------------------------

describe('solo lectura', () => {
  it('no crea filas en notifications ni en audit_logs', async () => {
    const c = await nuevaComunidad()
    const admin_ = await miembro(c, 'ADMIN')

    await seedIncident(c, admin_.id, { status: 'OPEN' })
    await dashboard(c, admin_)

    const notificaciones = await admin.notifications.count({ where: { community_id: c } })
    const auditoria = await admin.auditLogs.count({ where: { community_id: c } })

    expect(notificaciones).toBe(0)
    expect(auditoria).toBe(0)
  })
})
