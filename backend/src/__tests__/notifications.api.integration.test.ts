// ---------------------------------------------------------------------------
// Notificaciones por API (spec 14 §12).
//
// La regla de siempre: sembrar con privilegio, afirmar con restriccion. Los
// fixtures (usuarios, comunidad) se crean con `admin`, pero cada afirmacion
// sobre notificaciones se hace CON EL TOKEN DEL DESTINATARIO, por la API, para
// que lo que se prueba sea la RLS `notifications_own` y no que una tabla tiene
// filas.
//
// Lo que SOLO se puede demostrar aqui, y no en los unitarios:
//
//   1. La GENERACION cruza modulos: crear una incidencia, publicar un aviso o
//      abrir una votacion notifica a quien debe, en la MISMA transaccion del
//      hecho. Nace en SQL (`02o_notifications.sql`), no en TypeScript.
//   2. El destinatario es OTRO usuario: la funcion SECURITY DEFINER corre como
//      `postgres` (BYPASSRLS) y puede insertar para quien la politica de INSERT
//      no dejaria al usuario de contexto.
//   3. El aislamiento: las notificaciones de A no aparecen en la lista de B, y
//      B no puede marcar las de A (404, nunca 403).
//
// El teardown borra la comunidad (cascade) y los usuarios; `audit_logs` se purga
// antes por el mismo rodeo que el resto de suites (trigger append-only + FK).
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import type { notification_type } from '@prisma/client'
import { admin } from '../db-admin.js'
import { app, createUser, deleteCommunity, deleteUser, makeCommunity, makeMember, type TestUser } from './helpers.js'

const V1 = '/api/v1'

const usuarios: string[] = []
const comunidades: string[] = []

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

type Actor = TestUser & { token: string }

async function nuevoUsuario(fullName: string, email?: string): Promise<TestUser> {
  const user = await createUser({ fullName, email })
  usuarios.push(user.id)
  return user
}

async function tokenDe(user: TestUser): Promise<string> {
  const res = await request(app()).post(`${V1}/auth/login`).send({ email: user.email, password: user.password })
  expect(res.status).toBe(200)
  return `Bearer ${res.body.data.accessToken}`
}

async function actor(comunidad: string, role: 'NEIGHBOR' | 'PROVIDER' | 'ADMIN' | 'PRESIDENT', email?: string): Promise<Actor> {
  const user = await nuevoUsuario(`Actor ${role}`, email)
  await makeMember(user.id, comunidad, role)
  return { ...user, token: await tokenDe(user) }
}

type Escenario = {
  comunidad: string
  admin: Actor
  presidente: Actor
  vecinoA: Actor
  vecinoB: Actor
  proveedor: Actor
}

/** Una comunidad con un usuario de cada rol, todos con sesion. */
async function escenario(): Promise<Escenario> {
  const comunidad = await makeCommunity(`Notif ${randomUUID().slice(0, 8)}`)
  comunidades.push(comunidad)

  return {
    comunidad,
    admin: await actor(comunidad, 'ADMIN'),
    presidente: await actor(comunidad, 'PRESIDENT'),
    vecinoA: await actor(comunidad, 'NEIGHBOR'),
    vecinoB: await actor(comunidad, 'NEIGHBOR'),
    proveedor: await actor(comunidad, 'PROVIDER'),
  }
}

/** Un instante futuro a hora UTC entera (cae en la rejilla local de Madrid). */
function enFuturo(dias: number, horaUtc: number): Date {
  const d = new Date(Date.now() + dias * 86_400_000)
  d.setUTCHours(horaUtc, 0, 0, 0)
  return d
}

/** Siembra una notificacion directamente con `admin` (privilegio). */
async function sembrarNotif(
  userId: string,
  communityId: string | null,
  type: notification_type,
  over: { title?: string; body?: string | null; readAt?: Date | null; createdAt?: Date } = {},
): Promise<string> {
  const id = randomUUID()
  await admin.notifications.create({
    data: {
      id,
      user_id: userId,
      community_id: communityId,
      type,
      title: over.title ?? 'Notificación de prueba',
      body: over.body ?? 'Cuerpo',
      payload: { seed: true },
      read_at: over.readAt ?? null,
      created_at: over.createdAt ?? new Date(),
    },
  })
  return id
}

// ---------------------------------------------------------------------------
// Helpers de peticion
// ---------------------------------------------------------------------------

function lista(a: Actor, qs = '') {
  return request(app()).get(`${V1}/notifications${qs}`).set('Authorization', a.token)
}

async function tiposDe(a: Actor): Promise<string[]> {
  const res = await lista(a)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body.data.map((n: { type: string }) => n.type)
}

function contarDe(a: Actor) {
  return request(app()).get(`${V1}/notifications/unread-count`).set('Authorization', a.token)
}

function marcar(a: Actor, id: string) {
  return request(app()).patch(`${V1}/notifications/${id}/read`).set('Authorization', a.token)
}

function marcarTodas(a: Actor) {
  return request(app()).post(`${V1}/notifications/read-all`).set('Authorization', a.token)
}

// ---------------------------------------------------------------------------
// 1. Autenticacion
// ---------------------------------------------------------------------------

describe('autenticacion', () => {
  it('las cuatro rutas dan 401 sin token', async () => {
    expect((await request(app()).get(`${V1}/notifications`)).status).toBe(401)
    expect((await request(app()).get(`${V1}/notifications/unread-count`)).status).toBe(401)
    expect((await request(app()).patch(`${V1}/notifications/${randomUUID()}/read`)).status).toBe(401)
    expect((await request(app()).post(`${V1}/notifications/read-all`)).status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// 2. Generacion — incidencias
// ---------------------------------------------------------------------------

describe('generacion: incidencias', () => {
  it('INCIDENT_CREATED llega a la direccion, no al reportero ni al proveedor', async () => {
    const e = await escenario()

    const creada = await request(app())
      .post(`${V1}/communities/${e.comunidad}/incidents`)
      .set('Authorization', e.vecinoA.token)
      .send({ title: 'Fuga de agua', description: 'Hay una fuga en el garaje de la comunidad.' })
    expect(creada.status, JSON.stringify(creada.body)).toBe(201)
    const incidentId = creada.body.data.id

    expect(await tiposDe(e.admin)).toContain('INCIDENT_CREATED')
    expect(await tiposDe(e.presidente)).toContain('INCIDENT_CREATED')
    expect(await tiposDe(e.vecinoA)).not.toContain('INCIDENT_CREATED')
    expect(await tiposDe(e.proveedor)).not.toContain('INCIDENT_CREATED')

    const adminList = await lista(e.admin)
    const aviso = adminList.body.data.find((n: { type: string }) => n.type === 'INCIDENT_CREATED')
    expect(aviso.payload).toMatchObject({ incidentId })
    expect(aviso.createdAt).toMatch(/Z$/)
  })

  it('INCIDENT_UPDATED va al reportero y al proveedor asignado, no al actor', async () => {
    const e = await escenario()

    const creada = await request(app())
      .post(`${V1}/communities/${e.comunidad}/incidents`)
      .set('Authorization', e.vecinoA.token)
      .send({ title: 'Fuga de agua', description: 'Hay una fuga en el garaje de la comunidad.' })
    const incidentId = creada.body.data.id

    // El ADMIN asigna al proveedor (PUT con assignedToId).
    const asignada = await request(app())
      .put(`${V1}/incidents/${incidentId}`)
      .set('Authorization', e.admin.token)
      .send({
        title: 'Fuga de agua',
        description: 'Hay una fuga en el garaje de la comunidad.',
        category: 'OTHER',
        assignedToId: e.proveedor.id,
      })
    expect(asignada.status, JSON.stringify(asignada.body)).toBe(200)

    expect(await tiposDe(e.vecinoA)).toContain('INCIDENT_UPDATED')
    expect(await tiposDe(e.proveedor)).toContain('INCIDENT_UPDATED')
    expect(await tiposDe(e.admin)).not.toContain('INCIDENT_UPDATED')

    // El ADMIN cambia el estado: segundo INCIDENT_UPDATED a los mismos dos.
    const cambio = await request(app())
      .patch(`${V1}/incidents/${incidentId}/status`)
      .set('Authorization', e.admin.token)
      .send({ status: 'IN_PROGRESS' })
    expect(cambio.status, JSON.stringify(cambio.body)).toBe(200)

    const delVecino = await lista(e.vecinoA)
    const actualizados = delVecino.body.data.filter((n: { type: string }) => n.type === 'INCIDENT_UPDATED')
    expect(actualizados).toHaveLength(2)
    expect(actualizados[0].payload).toHaveProperty('incidentId', incidentId)
  })
})

// ---------------------------------------------------------------------------
// 3. Generacion — reservas
// ---------------------------------------------------------------------------

describe('generacion: reservas', () => {
  it('RESERVATION_CREATED a la direccion y RESERVATION_CANCELLED al reservante y a la direccion', async () => {
    const e = await escenario()

    const zona = await request(app())
      .post(`${V1}/communities/${e.comunidad}/common-areas`)
      .set('Authorization', e.admin.token)
      .send({ name: 'Piscina' })
    expect(zona.status, JSON.stringify(zona.body)).toBe(201)
    const areaId = zona.body.data.id

    const inicio = enFuturo(3, 10)
    const reserva = await request(app())
      .post(`${V1}/common-areas/${areaId}/reservations`)
      .set('Authorization', e.vecinoA.token)
      .send({ startsAt: inicio.toISOString(), endsAt: new Date(inicio.getTime() + 3_600_000).toISOString() })
    expect(reserva.status, JSON.stringify(reserva.body)).toBe(201)
    const reservationId = reserva.body.data.id

    // Creada: direccion si, reservante no (es el actor).
    expect(await tiposDe(e.admin)).toContain('RESERVATION_CREATED')
    expect(await tiposDe(e.presidente)).toContain('RESERVATION_CREATED')
    expect(await tiposDe(e.vecinoA)).not.toContain('RESERVATION_CREATED')

    // Cancelada: reservante Y direccion. Se cancela como ADMIN, no como el
    // propio reservante, porque la regla NTF-7 (el actor nunca se auto-notifica)
    // haria que el reservante que cancela lo suyo no recibiera nada.
    const cancelada = await request(app())
      .patch(`${V1}/reservations/${reservationId}/cancel`)
      .set('Authorization', e.admin.token)
      .send({})
    expect(cancelada.status, JSON.stringify(cancelada.body)).toBe(200)

    expect(await tiposDe(e.vecinoA)).toContain('RESERVATION_CANCELLED')
    expect(await tiposDe(e.presidente)).toContain('RESERVATION_CANCELLED')
    expect(await tiposDe(e.admin)).not.toContain('RESERVATION_CANCELLED')
  })
})

// ---------------------------------------------------------------------------
// 4. Generacion — avisos y votaciones (difusion)
// ---------------------------------------------------------------------------

describe('generacion: avisos y votaciones', () => {
  it('ANNOUNCEMENT_NEW va a todos los vecinos, no al autor ni al proveedor', async () => {
    const e = await escenario()

    const aviso = await request(app())
      .post(`${V1}/communities/${e.comunidad}/announcements`)
      .set('Authorization', e.admin.token)
      .send({ title: 'Corte de agua', body: 'El martes habrá corte de agua por la mañana.' })
    expect(aviso.status, JSON.stringify(aviso.body)).toBe(201)

    expect(await tiposDe(e.vecinoA)).toContain('ANNOUNCEMENT_NEW')
    expect(await tiposDe(e.vecinoB)).toContain('ANNOUNCEMENT_NEW')
    expect(await tiposDe(e.presidente)).toContain('ANNOUNCEMENT_NEW')
    expect(await tiposDe(e.admin)).not.toContain('ANNOUNCEMENT_NEW')
    expect(await tiposDe(e.proveedor)).not.toContain('ANNOUNCEMENT_NEW')
  })

  it('VOTE_OPEN y VOTE_CLOSED van a la difusion, no al gestor ni al proveedor', async () => {
    const e = await escenario()

    const inicio = new Date(Date.now() - 3_600_000)
    const fin = new Date(Date.now() + 5 * 86_400_000)
    const voto = await request(app())
      .post(`${V1}/communities/${e.comunidad}/votes`)
      .set('Authorization', e.admin.token)
      .send({
        title: 'Pintar el portal',
        question: '¿Pintamos el portal este año?',
        startsAt: inicio.toISOString(),
        endsAt: fin.toISOString(),
        options: ['Sí', 'No'],
      })
    expect(voto.status, JSON.stringify(voto.body)).toBe(201)
    const voteId = voto.body.data.id

    // Un DRAFT no notifica a nadie.
    expect(await tiposDe(e.vecinoA)).not.toContain('VOTE_OPEN')

    const publicado = await request(app())
      .post(`${V1}/votes/${voteId}/publish`)
      .set('Authorization', e.admin.token)
      .send({})
    expect(publicado.status, JSON.stringify(publicado.body)).toBe(200)

    expect(await tiposDe(e.vecinoA)).toContain('VOTE_OPEN')
    expect(await tiposDe(e.vecinoB)).toContain('VOTE_OPEN')
    expect(await tiposDe(e.admin)).not.toContain('VOTE_OPEN')
    expect(await tiposDe(e.proveedor)).not.toContain('VOTE_OPEN')

    const cerrado = await request(app())
      .post(`${V1}/votes/${voteId}/close`)
      .set('Authorization', e.admin.token)
      .send({})
    expect(cerrado.status, JSON.stringify(cerrado.body)).toBe(200)

    expect(await tiposDe(e.vecinoA)).toContain('VOTE_CLOSED')
  })
})

// ---------------------------------------------------------------------------
// 5. Generacion — miembros
// ---------------------------------------------------------------------------

describe('generacion: miembros', () => {
  it('MEMBER_JOINED va a la direccion al canjear una invitacion', async () => {
    const e = await escenario()
    const email = `nuevo-${randomUUID()}@communityhub.test`

    const invitacion = await request(app())
      .post(`${V1}/communities/${e.comunidad}/invitations`)
      .set('Authorization', e.admin.token)
      .send({ email })
    expect(invitacion.status, JSON.stringify(invitacion.body)).toBe(201)
    const code = invitacion.body.data.code

    const nuevo = await nuevoUsuario('Vecino Nuevo', email)
    const token = await tokenDe(nuevo)

    const canje = await request(app()).post(`${V1}/invitations/redeem`).set('Authorization', token).send({ code })
    expect(canje.status, JSON.stringify(canje.body)).toBe(201)

    expect(await tiposDe(e.admin)).toContain('MEMBER_JOINED')
    expect(await tiposDe(e.presidente)).toContain('MEMBER_JOINED')
    // El que se une es el actor: no se auto-notifica.
    const recien = await request(app()).get(`${V1}/notifications`).set('Authorization', token)
    expect(recien.body.data.some((n: { type: string }) => n.type === 'MEMBER_JOINED')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 6. Listado, paginacion y filtro unread
// ---------------------------------------------------------------------------

describe('listado', () => {
  it('orden created_at desc, con paginacion en meta', async () => {
    const e = await escenario()

    for (let i = 0; i < 25; i += 1) {
      await sembrarNotif(e.vecinoA.id, e.comunidad, 'ANNOUNCEMENT_NEW', {
        title: `N-${i}`,
        createdAt: new Date(Date.now() - i * 60_000),
      })
    }

    const p1 = await lista(e.vecinoA, '?page=1&limit=20')
    expect(p1.status).toBe(200)
    expect(p1.body.data).toHaveLength(20)
    expect(p1.body.meta).toEqual({ page: 1, limit: 20, total: 25, totalPages: 2 })

    // Mas nuevas primero: la de `createdAt` mayor (i=0) va la primera.
    expect(p1.body.data[0].title).toBe('N-0')
    expect(p1.body.data[19].title).toBe('N-19')

    const p2 = await lista(e.vecinoA, '?page=2&limit=20')
    expect(p2.body.data).toHaveLength(5)
    expect(p2.body.meta.totalPages).toBe(2)
  })

  it('unread=true filtra solo las no leidas', async () => {
    const e = await escenario()
    await sembrarNotif(e.vecinoA.id, e.comunidad, 'VOTE_OPEN', { title: 'Leída', readAt: new Date() })
    await sembrarNotif(e.vecinoA.id, e.comunidad, 'VOTE_OPEN', { title: 'Sin leer' })

    const todas = await lista(e.vecinoA)
    expect(todas.body.data).toHaveLength(2)

    const sinLeer = await lista(e.vecinoA, '?unread=true')
    expect(sinLeer.body.data).toHaveLength(1)
    expect(sinLeer.body.data[0].title).toBe('Sin leer')
    expect(sinLeer.body.data[0].readAt).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 7. Contador y read-all
// ---------------------------------------------------------------------------

describe('contador y read-all', () => {
  it('unread-count cuadra, baja al marcar y read-all lo deja en 0', async () => {
    const e = await escenario()
    const a1 = await sembrarNotif(e.vecinoA.id, e.comunidad, 'VOTE_OPEN')
    await sembrarNotif(e.vecinoA.id, e.comunidad, 'ANNOUNCEMENT_NEW')
    await sembrarNotif(e.vecinoA.id, e.comunidad, 'VOTE_CLOSED', { readAt: new Date() })

    expect((await contarDe(e.vecinoA)).body.data.count).toBe(2)

    const leida = await marcar(e.vecinoA, a1)
    expect(leida.status, JSON.stringify(leida.body)).toBe(200)
    expect((await contarDe(e.vecinoA)).body.data.count).toBe(1)

    const todas = await marcarTodas(e.vecinoA)
    expect(todas.status).toBe(200)
    expect(todas.body.data.updated).toBe(1)
    expect((await contarDe(e.vecinoA)).body.data.count).toBe(0)

    // read-all de nuevo: nada que marcar.
    expect((await marcarTodas(e.vecinoA)).body.data.updated).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 8. Marcado (idempotencia y 404 cruzado)
// ---------------------------------------------------------------------------

describe('marcado', () => {
  it('PATCH read es idempotente y conserva readAt', async () => {
    const e = await escenario()
    const id = await sembrarNotif(e.vecinoA.id, e.comunidad, 'VOTE_OPEN')

    const primera = await marcar(e.vecinoA, id)
    expect(primera.status, JSON.stringify(primera.body)).toBe(200)
    expect(primera.body.data.readAt).not.toBeNull()

    const segunda = await marcar(e.vecinoA, id)
    expect(segunda.status).toBe(200)
    expect(segunda.body.data.readAt).toBe(primera.body.data.readAt)
  })

  it('marcar la de OTRO usuario da 404 (nunca 403)', async () => {
    const e = await escenario()
    const ajena = await sembrarNotif(e.vecinoB.id, e.comunidad, 'VOTE_OPEN')

    const res = await marcar(e.vecinoA, ajena)
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
// 8b. Aislamiento entre usuarios
// ---------------------------------------------------------------------------

describe('aislamiento', () => {
  it('las notificaciones de A no aparecen en la lista de B', async () => {
    const e = await escenario()
    await sembrarNotif(e.vecinoA.id, e.comunidad, 'VOTE_OPEN', { title: 'De A' })
    await sembrarNotif(e.vecinoB.id, e.comunidad, 'VOTE_CLOSED', { title: 'De B' })

    const deA = await lista(e.vecinoA)
    const deB = await lista(e.vecinoB)

    expect(deA.body.data.map((n: { title: string }) => n.title)).toEqual(['De A'])
    expect(deB.body.data.map((n: { title: string }) => n.title)).toEqual(['De B'])
  })
})

// ---------------------------------------------------------------------------
// 9. Validacion
// ---------------------------------------------------------------------------

describe('validacion', () => {
  it('rechaza limit fuera de rango y unread no booleano', async () => {
    const e = await escenario()

    for (const qs of ['?limit=0', '?limit=101', '?page=0', '?unread=quizá', '?q=x']) {
      const res = await lista(e.vecinoA, qs)
      expect(res.status, qs).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('rechaza un :id que no es UUID', async () => {
    const e = await escenario()
    const res = await marcar(e.vecinoA, 'no-soy-un-uuid')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})

