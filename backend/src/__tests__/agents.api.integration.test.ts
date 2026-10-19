// ---------------------------------------------------------------------------
// Agentes de runtime por HTTP (integracion).
//
// Un `run` de agente es un turno de asistente con contexto propio: identidad
// (fichero .agent.md) + skills + tools acotadas por rol. Estos tests fijan el
// contrato:
//
//   1. `GET /ai/agents` lista solo los agentes de runtime (M-10).
//   2. Un agente resuelve con el rol correcto y deja auditoria `agent.run` (M-8).
//   3. El rol manda: un NEIGHBOR no ejecuta el agente de finanzas (M-10).
//   4. Un agente inexistente, o uno de desarrollo, da 404.
//
// El proveedor LLM se sustituye por un `FakeLLMClient` guionizado (AI-3): la IA
// nunca sale a la red en los tests.
// ---------------------------------------------------------------------------

import request from 'supertest'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { admin } from '../db-admin.js'
import { FakeLLMClient } from '../ai/llm/fake.js'
import { resetLLMClient, setLLMClient } from '../ai/llm/router.js'
import { app, createUser, deleteCommunity, deleteUser, makeAdmin, makeCommunity, makeMember, type TestUser } from './helpers.js'

const V1 = '/api/v1'
const AGENTS = `${V1}/ai/agents`

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
  resetLLMClient()
  while (comunidades.length > 0) {
    const id = comunidades.pop() as string
    await purgarAuditoria({ communityId: id }).catch(() => undefined)
    await deleteCommunity(id).catch(() => undefined)
  }
})

afterAll(async () => {
  while (usuarios.length > 0) {
    const id = usuarios.pop() as string
    await purgarAuditoria({ actorId: id }).catch(() => undefined)
    await deleteUser(id).catch(() => undefined)
  }
})

async function tokenDe(user: TestUser): Promise<string> {
  const res = await request(app()).post(`${V1}/auth/login`).send({ email: user.email, password: user.password })
  expect(res.status).toBe(200)
  return `Bearer ${res.body.data.accessToken}`
}

function respuestaFija(texto: string): FakeLLMClient {
  return new FakeLLMClient([{ content: texto, toolCalls: [], tokensIn: 3, tokensOut: 4, model: 'fake' }])
}

describe('GET /ai/agents', () => {
  it('lista los agentes de runtime y ninguno de desarrollo', async () => {
    const user = await createUser({ fullName: 'Vecina agentes' })
    usuarios.push(user.id)

    const res = await request(app()).get(AGENTS).set('Authorization', await tokenDe(user))
    expect(res.status).toBe(200)

    const nombres = (res.body.data as Array<{ name: string }>).map((a) => a.name)
    expect(nombres.sort()).toEqual(['community', 'finance', 'maintenance'])
    expect(nombres).not.toContain('testing')
  })

  it('sin sesion, 401', async () => {
    const res = await request(app()).get(AGENTS)
    expect(res.status).toBe(401)
  })
})

describe('POST /ai/agents/:name/run', () => {
  it('un NEIGHBOR ejecuta el agente de comunidad y deja auditoria', async () => {
    const comunidad = await makeCommunity('Comunidad agentes')
    comunidades.push(comunidad)
    const user = await createUser({ fullName: 'Vecina agente' })
    usuarios.push(user.id)
    await makeMember(user.id, comunidad, 'NEIGHBOR')

    setLLMClient(new FakeLLMClient([{ content: 'La comunidad se llama Comunidad agentes.', toolCalls: [], tokensIn: 5, tokensOut: 4, model: 'fake' }]))

    const res = await request(app())
      .post(`${AGENTS}/community/run`)
      .set('Authorization', await tokenDe(user))
      .send({ communityId: comunidad, message: '¿Cómo se llama la comunidad?' })

    expect(res.status).toBe(200)
    expect(res.body.data.agent).toBe('community')
    expect(res.body.data.answer).toContain('Comunidad agentes')

    const auditoria = await admin.auditLogs.findMany({
      where: { community_id: comunidad, action: 'agent.run' },
    })
    expect(auditoria).toHaveLength(1)
    expect(auditoria[0]?.agent_name).toBe('community')
    expect(auditoria[0]?.entity_id).toBe('community')
  })

  it('un NEIGHBOR no puede ejecutar el agente de finanzas (403)', async () => {
    const comunidad = await makeCommunity('MCP finanzas')
    comunidades.push(comunidad)
    const user = await createUser({ fullName: 'Vecina sin finanzas' })
    usuarios.push(user.id)
    await makeMember(user.id, comunidad, 'NEIGHBOR')

    setLLMClient(new FakeLLMClient([{ content: 'no deberia llegar aqui', toolCalls: [], tokensIn: 1, tokensOut: 1, model: 'fake' }]))

    const res = await request(app())
      .post(`${AGENTS}/finance/run`)
      .set('Authorization', await tokenDe(user))
      .send({ communityId: comunidad, message: '¿Cuánto se ha gastado?' })

    expect(res.status).toBe(403)
  })

  it('un ADMIN ejecuta el agente de finanzas', async () => {
    const comunidad = await makeCommunity('Comunidad finanzas ok')
    comunidades.push(comunidad)
    const user = await createUser({ fullName: 'Admin finanzas' })
    usuarios.push(user.id)
    await makeAdmin(user.id, comunidad)

    setLLMClient(new FakeLLMClient([{ content: 'El saldo es 0.', toolCalls: [], tokensIn: 3, tokensOut: 4, model: 'fake' }]))

    const respuesta = await request(app())
      .post(`${AGENTS}/finance/run`)
      .set('Authorization', await tokenDe(user))
      .send({ communityId: comunidad, message: '¿Cuál es el saldo?' })

    expect(respuesta.status).toBe(200)
    expect(respuesta.body.data.agent).toBe('finance')
  })

  it('un agente inexistente da 404', async () => {
    const comunidad = await makeCommunity('Comunidad agente 404')
    comunidades.push(comunidad)
    const user = await createUser({ fullName: 'Admin 404' })
    usuarios.push(user.id)
    await makeAdmin(user.id, comunidad)

    const res = await request(app())
      .post(`${AGENTS}/no-existe/run`)
      .set('Authorization', await tokenDe(user))
      .send({ communityId: comunidad, message: 'hola' })

    expect(res.status).toBe(404)
  })

  it('un agente de desarrollo da 404', async () => {
    const comunidad = await makeCommunity('Comunidad agente dev')
    comunidades.push(comunidad)
    const user = await createUser({ fullName: 'Admin dev' })
    usuarios.push(user.id)
    await makeAdmin(user.id, comunidad)

    const res = await request(app())
      .post(`${AGENTS}/testing/run`)
      .set('Authorization', await tokenDe(user))
      .send({ communityId: comunidad, message: 'hola' })

    expect(res.status).toBe(404)
  })
})
