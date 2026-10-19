// ---------------------------------------------------------------------------
// IA por API: chat (SSE), sesiones, clasificacion, borradores, confirm y tools.
//
// Los fixtures se siembran con `admin` (privilegio) y se afirma por la API (rol
// app_runtime con RLS). El proveedor LLM se sustituye por un `FakeLLMClient`
// guionizado con `setLLMClient`: la IA NUNCA sale a la red en los tests (AI-3).
//
// Los comportamientos que solo se pueden demostrar aqui:
//
//   1. AI-1/AI-11: el chat va por SSE (meta, tool_call, citation, token, done) y
//      el bucle de tools ejecuta una tool de verdad antes de responder.
//   2. AI-3: sin proveedor, chat da 503 AI_NOT_CONFIGURED (no un stream roto).
//   3. AI-5: con el presupuesto del dia agotado, 429 AI_QUOTA_EXCEEDED antes de
//      abrir el stream.
//   4. AI-2: confirmar un borrador crea la incidencia con created_via
//      AI_SUGGESTION y reporter_id = actor humano; classify nunca escribe.
//   5. AI-7: una sesion ajena es un 404, tanto al leer como al borrar.
//   6. AI-9: el catalogo de tools se filtra por rol (las de finanzas solo ADMIN).
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { env } from '../config/env.js'
import { admin } from '../db-admin.js'
import { FakeLLMClient } from '../ai/llm/fake.js'
import { resetLLMClient, setLLMClient } from '../ai/llm/router.js'
import {
  app,
  createUser,
  deleteCommunity,
  deleteUser,
  makeCommunity,
  makeMember,
  type TestUser,
} from './helpers.js'

const V1 = '/api/v1'
const AI = `${V1}/ai`

const usuarios: string[] = []
const comunidades: string[] = []

/**
 * Borra las filas de auditoria que cuelgan de un fixture.
 *
 * `audit_logs` es append-only por trigger (01_schema §4.19) y sus FKs a users y
 * communities son `on delete set null`: al borrar el fixture, la accion de FK
 * intenta un UPDATE que el trigger rechaza con 23001. La app no borra usuarios ni
 * comunidades en ningun flujo real (no hay endpoint), asi que el unico sitio que
 * lo necesita es el teardown de los tests. Se desactiva el trigger el tiempo
 * justo para limpiar las filas de ESTE fixture.
 */
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
  resetLLMClient()
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

async function nuevoUsuario(
  fullName: string,
  globalRole: 'NEIGHBOR' | 'ADMIN_SA' = 'NEIGHBOR',
): Promise<TestUser> {
  const user = await createUser({ fullName, globalRole })
  usuarios.push(user.id)
  return user
}

async function nuevaComunidad(nombre = 'Comunidad IA'): Promise<string> {
  const id = await makeCommunity(nombre)
  comunidades.push(id)
  return id
}

async function tokenDe(user: TestUser): Promise<string> {
  const res = await request(app())
    .post(`${V1}/auth/login`)
    .send({ email: user.email, password: user.password })
  expect(res.status).toBe(200)
  return `Bearer ${res.body.data.accessToken}`
}

type Actor = TestUser & { token: string }

/** Un miembro de la comunidad con el rol pedido. */
async function miembro(
  comunidad: string,
  role: 'NEIGHBOR' | 'PROVIDER' | 'ADMIN' | 'PRESIDENT',
): Promise<Actor> {
  const user = await nuevoUsuario(`Actor ${role}`)
  await makeMember(user.id, comunidad, role)
  return { ...user, token: await tokenDe(user) }
}

/** Un usuario que no pertenece a ninguna comunidad. */
async function outsider(): Promise<Actor> {
  const user = await nuevoUsuario('De fuera')
  return { ...user, token: await tokenDe(user) }
}

/** Peticion de chat con el mensaje minimo; el resto por defecto. */
function chat(a: Actor, body: Record<string, unknown>): request.Test {
  return request(app())
    .post(`${AI}/chat`)
    .set('Authorization', a.token)
    .send({ message: 'Hola', ...body })
}

type SseEvent = { event: string; data: Record<string, unknown> }

function sseEvents(text: string): SseEvent[] {
  return text
    .split('\n\n')
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const lines = block.split('\n')
      const event = (lines.find((l) => l.startsWith('event:')) ?? 'event: ?').replace('event: ', '')
      const raw = (lines.find((l) => l.startsWith('data:')) ?? 'data: null').replace('data: ', '')
      return { event, data: JSON.parse(raw) as Record<string, unknown> }
    })
}

function sessionIdOf(events: SseEvent[]): string {
  const meta = events.find((e) => e.event === 'meta')
  if (!meta) throw new Error('El stream no emitio el evento meta.')
  return meta.data.sessionId as string
}

/** Un clasificador guionizado que devuelve el JSON que daria el modelo. */
function clasificadorFake(overrides: Record<string, unknown> = {}): FakeLLMClient {
  return new FakeLLMClient(() => ({
    content: JSON.stringify({
      category: 'PLUMBING',
      priority: 'HIGH',
      title: 'Fuga de agua en el baño',
      description: 'Hay una fuga de agua en el baño del portal.',
      confidence: 0.9,
      ...overrides,
    }),
    toolCalls: [],
    tokensIn: 10,
    tokensOut: 12,
    model: env.LLM_FAST_MODEL,
  }))
}

// ---------------------------------------------------------------------------
// Autenticacion
// ---------------------------------------------------------------------------

describe('autenticacion de las rutas de IA', () => {
  it('sin token, una ruta de IA da 401', async () => {
    const res = await request(app()).get(`${AI}/tools`)
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Chat (SSE)
// ---------------------------------------------------------------------------

describe('POST /ai/chat (SSE)', () => {
  it('emite meta y done, y persiste la sesion y sus dos mensajes', async () => {
    const comunidad = await nuevaComunidad()
    const vecino = await miembro(comunidad, 'NEIGHBOR')
    setLLMClient(
      new FakeLLMClient([
        { content: 'Hola, vecino.', toolCalls: [], tokensIn: 3, tokensOut: 2, model: 'fake' },
      ]),
    )

    const res = await chat(vecino, { communityId: comunidad })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')

    const eventos = sseEvents(res.text)
    expect(eventos[0]?.event).toBe('meta')
    expect(eventos.at(-1)?.event).toBe('done')
    expect(eventos.some((e) => e.event === 'token')).toBe(true)

    const sessionId = sessionIdOf(eventos)

    const sesiones = await request(app())
      .get(`${AI}/chat/sessions`)
      .set('Authorization', vecino.token)
    expect(sesiones.status).toBe(200)
    expect(sesiones.body.data.map((s: { id: string }) => s.id)).toContain(sessionId)

    const mensajes = await request(app())
      .get(`${AI}/chat/sessions/${sessionId}/messages`)
      .set('Authorization', vecino.token)
    expect(mensajes.status).toBe(200)
    expect(mensajes.body.data.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant'])
  })

  it('ejecuta la tool que pide el modelo y la cita', async () => {
    const comunidad = await nuevaComunidad('Comunidad con tools')
    const vecino = await miembro(comunidad, 'NEIGHBOR')

    setLLMClient(
      new FakeLLMClient([
        {
          content: '',
          toolCalls: [{ id: 'call-1', name: 'get_community', args: {} }],
          tokensIn: 4,
          tokensOut: 1,
          model: 'fake',
        },
        {
          content: 'La comunidad se llama Comunidad con tools.',
          toolCalls: [],
          tokensIn: 3,
          tokensOut: 5,
          model: 'fake',
        },
      ]),
    )

    const res = await chat(vecino, { communityId: comunidad })
    expect(res.status).toBe(200)

    const eventos = sseEvents(res.text)
    expect(eventos.find((e) => e.event === 'tool_call')?.data).toMatchObject({
      name: 'get_community',
    })
    expect(eventos.find((e) => e.event === 'citation')?.data).toMatchObject({
      tool: 'get_community',
    })
    expect(eventos.at(-1)?.event).toBe('done')
  })

  it('sin proveedor configurado da 503 AI_NOT_CONFIGURED (JSON, no un stream)', async () => {
    const comunidad = await nuevaComunidad()
    const vecino = await miembro(comunidad, 'NEIGHBOR')
    setLLMClient(null)

    const res = await chat(vecino, { communityId: comunidad })
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('AI_NOT_CONFIGURED')
  })

  it('con el presupuesto del dia agotado da 429 AI_QUOTA_EXCEEDED', async () => {
    const comunidad = await nuevaComunidad()
    const vecino = await miembro(comunidad, 'NEIGHBOR')

    await admin.$executeRaw`
      insert into ai_usage (user_id, usage_date, requests)
      values (${vecino.id}::uuid, current_date, ${env.AI_DAILY_MAX_REQUESTS})
      on conflict (user_id, usage_date) do update set requests = ${env.AI_DAILY_MAX_REQUESTS}
    `

    const res = await chat(vecino, { communityId: comunidad })
    expect(res.status).toBe(429)
    expect(res.body.error.code).toBe('AI_QUOTA_EXCEEDED')
  })

  it('con una comunidad de la que no es miembro da 403', async () => {
    const comunidad = await nuevaComunidad()
    const ajeno = await outsider()

    const res = await chat(ajeno, { communityId: comunidad })
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// Sesiones (AI-7)
// ---------------------------------------------------------------------------

describe('sesiones de chat', () => {
  it('una sesion ajena da 404 al leer y al borrar; el dueño puede leerla y borrarla', async () => {
    const comunidad = await nuevaComunidad()
    const dueno = await miembro(comunidad, 'NEIGHBOR')
    const ajeno = await miembro(comunidad, 'NEIGHBOR')

    const res = await chat(dueno, { communityId: comunidad })
    const sessionId = sessionIdOf(sseEvents(res.text))

    const lecturaAjena = await request(app())
      .get(`${AI}/chat/sessions/${sessionId}/messages`)
      .set('Authorization', ajeno.token)
    expect(lecturaAjena.status).toBe(404)
    expect(lecturaAjena.body.error.code).toBe('CHAT_SESSION_NOT_FOUND')

    const borradoAjeno = await request(app())
      .delete(`${AI}/chat/sessions/${sessionId}`)
      .set('Authorization', ajeno.token)
    expect(borradoAjeno.status).toBe(404)

    const lecturaDueno = await request(app())
      .get(`${AI}/chat/sessions/${sessionId}/messages`)
      .set('Authorization', dueno.token)
    expect(lecturaDueno.status).toBe(200)

    const borradoDueno = await request(app())
      .delete(`${AI}/chat/sessions/${sessionId}`)
      .set('Authorization', dueno.token)
    expect(borradoDueno.status).toBe(204)

    const trasBorrar = await request(app())
      .get(`${AI}/chat/sessions/${sessionId}/messages`)
      .set('Authorization', dueno.token)
    expect(trasBorrar.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// Clasificacion (AI-2, AI-6)
// ---------------------------------------------------------------------------

describe('POST /ai/incidents/classify', () => {
  it('devuelve una propuesta y NUNCA crea la incidencia', async () => {
    const comunidad = await nuevaComunidad()
    const vecino = await miembro(comunidad, 'NEIGHBOR')
    setLLMClient(clasificadorFake())

    const antes = await admin.incidents.count({ where: { community_id: comunidad } })

    const res = await request(app())
      .post(`${AI}/incidents/classify`)
      .set('Authorization', vecino.token)
      .send({ communityId: comunidad, description: `Fuga de agua ${randomUUID()}` })

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      category: 'PLUMBING',
      priority: 'HIGH',
      needsHumanReview: false,
    })

    const despues = await admin.incidents.count({ where: { community_id: comunidad } })
    expect(despues).toBe(antes)
  })

  it('sin proveedor cae a la heuristica y sigue devolviendo propuesta', async () => {
    const comunidad = await nuevaComunidad()
    const vecino = await miembro(comunidad, 'NEIGHBOR')
    setLLMClient(null)

    const res = await request(app())
      .post(`${AI}/incidents/classify`)
      .set('Authorization', vecino.token)
      .send({ communityId: comunidad, description: `El ascensor hace ruido ${randomUUID()}` })

    expect(res.status).toBe(200)
    expect(res.body.data.category).toBe('ELEVATOR')
    expect(res.body.data.needsHumanReview).toBe(true)
  })

  it('una comunidad ajena da 403', async () => {
    const comunidad = await nuevaComunidad()
    const ajeno = await outsider()

    const res = await request(app())
      .post(`${AI}/incidents/classify`)
      .set('Authorization', ajeno.token)
      .send({ communityId: comunidad, description: 'Hay una fuga de agua' })

    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// Borradores y confirmacion (AI-2, AI-14)
// ---------------------------------------------------------------------------

async function crearBorrador(
  a: Actor,
  comunidad: string,
  description: string,
): Promise<request.Response> {
  return request(app())
    .post(`${AI}/incidents/drafts`)
    .set('Authorization', a.token)
    .send({ communityId: comunidad, description })
}

describe('borradores de incidencia y confirmacion', () => {
  it('crea el borrador (201, Location) y al confirmar crea la incidencia AI_SUGGESTION', async () => {
    const comunidad = await nuevaComunidad()
    const vecino = await miembro(comunidad, 'NEIGHBOR')
    setLLMClient(clasificadorFake())

    const draft = await crearBorrador(vecino, comunidad, 'Hay una fuga de agua en el sótano')
    expect(draft.status).toBe(201)
    expect(draft.headers.location).toBe(`${AI}/incidents/drafts/${draft.body.data.id}`)
    expect(draft.body.data).toMatchObject({ status: 'PENDING', needsHumanReview: false })

    const draftId = draft.body.data.id as string

    const confirm = await request(app())
      .post(`${AI}/incidents/drafts/${draftId}/confirm`)
      .set('Authorization', vecino.token)
      .send({})
    expect(confirm.status).toBe(201)
    expect(confirm.body.data.createdVia).toBe('AI_SUGGESTION')

    const incidentId = confirm.body.data.id as string

    const creada = await admin.incidents.findUnique({ where: { id: incidentId } })
    expect(creada?.created_via).toBe('AI_SUGGESTION')
    expect(creada?.reporter_id).toBe(vecino.id)

    const borrador = await admin.incidentDrafts.findUnique({ where: { id: draftId } })
    expect(borrador?.status).toBe('CONFIRMED')
    expect(borrador?.incident_id).toBe(incidentId)
  })

  it('un borrador ajeno da 404 al confirmar', async () => {
    const comunidad = await nuevaComunidad()
    const dueno = await miembro(comunidad, 'NEIGHBOR')
    const otro = await miembro(comunidad, 'NEIGHBOR')
    setLLMClient(clasificadorFake())

    const draft = await crearBorrador(dueno, comunidad, 'Fuga de agua en la cocina comunitaria')
    const res = await request(app())
      .post(`${AI}/incidents/drafts/${draft.body.data.id}/confirm`)
      .set('Authorization', otro.token)
      .send({})

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('INCIDENT_DRAFT_NOT_FOUND')
  })

  it('confirmar dos veces da 409 INCIDENT_DRAFT_ALREADY_CONFIRMED', async () => {
    const comunidad = await nuevaComunidad()
    const vecino = await miembro(comunidad, 'NEIGHBOR')
    setLLMClient(clasificadorFake())

    const draft = await crearBorrador(vecino, comunidad, 'Fuga de agua en el cuarto de contadores')
    const url = `${AI}/incidents/drafts/${draft.body.data.id}/confirm`

    expect(
      (await request(app()).post(url).set('Authorization', vecino.token).send({})).status,
    ).toBe(201)

    const segunda = await request(app()).post(url).set('Authorization', vecino.token).send({})
    expect(segunda.status).toBe(409)
    expect(segunda.body.error.code).toBe('INCIDENT_DRAFT_ALREADY_CONFIRMED')
  })

  it('el parche del humano pisa la propuesta', async () => {
    const comunidad = await nuevaComunidad()
    const vecino = await miembro(comunidad, 'NEIGHBOR')
    setLLMClient(clasificadorFake())

    const draft = await crearBorrador(vecino, comunidad, 'Ruido fuerte en la puerta de entrada')
    const res = await request(app())
      .post(`${AI}/incidents/drafts/${draft.body.data.id}/confirm`)
      .set('Authorization', vecino.token)
      .send({ title: 'Puerta del portal rota', category: 'ELEVATOR', priority: 'CRITICAL' })

    expect(res.status).toBe(201)
    expect(res.body.data).toMatchObject({
      title: 'Puerta del portal rota',
      category: 'ELEVATOR',
      priority: 'CRITICAL',
    })
  })
})

// ---------------------------------------------------------------------------
// Catalogo y preview de tools (AI-9, AI-10)
// ---------------------------------------------------------------------------

describe('GET /ai/tools', () => {
  it('un NEIGHBOR no ve las herramientas de finanzas', async () => {
    const comunidad = await nuevaComunidad()
    const vecino = await miembro(comunidad, 'NEIGHBOR')

    const res = await request(app()).get(`${AI}/tools`).set('Authorization', vecino.token)
    expect(res.status).toBe(200)

    const nombres = res.body.data.map((t: { name: string }) => t.name)
    expect(nombres).toContain('get_community')
    expect(nombres).not.toContain('get_expenses')
  })

  it('un ADMIN si ve las herramientas de finanzas', async () => {
    const comunidad = await nuevaComunidad()
    const administrador = await miembro(comunidad, 'ADMIN')

    const res = await request(app()).get(`${AI}/tools`).set('Authorization', administrador.token)
    const nombres = res.body.data.map((t: { name: string }) => t.name)
    expect(nombres).toContain('get_expenses')
    expect(nombres).toContain('get_finance_summary')
  })
})

describe('POST /ai/tools/:toolName/preview', () => {
  it('una tool inexistente da 404 AI_TOOL_UNKNOWN', async () => {
    const comunidad = await nuevaComunidad()
    const vecino = await miembro(comunidad, 'NEIGHBOR')

    const res = await request(app())
      .post(`${AI}/tools/inventada/preview`)
      .set('Authorization', vecino.token)
      .send({ communityId: comunidad, args: {} })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('AI_TOOL_UNKNOWN')
  })

  it('una tool fuera del rol da 403 AI_TOOL_FORBIDDEN', async () => {
    const comunidad = await nuevaComunidad()
    const vecino = await miembro(comunidad, 'NEIGHBOR')

    const res = await request(app())
      .post(`${AI}/tools/get_expenses/preview`)
      .set('Authorization', vecino.token)
      .send({ communityId: comunidad, args: {} })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('AI_TOOL_FORBIDDEN')
  })

  it('una tool valida devuelve su resultado', async () => {
    const comunidad = await nuevaComunidad('Comunidad para preview')
    const vecino = await miembro(comunidad, 'NEIGHBOR')

    const res = await request(app())
      .post(`${AI}/tools/get_community/preview`)
      .set('Authorization', vecino.token)
      .send({ communityId: comunidad, args: {} })

    expect(res.status).toBe(200)
    expect(res.body.data.tool).toBe('get_community')
    expect(res.body.data.result).toMatchObject({ id: comunidad, name: 'Comunidad para preview' })
  })
})
