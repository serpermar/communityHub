// ---------------------------------------------------------------------------
// Tarjeta MCP por HTTP (integracion).
//
// Prueba el contrato del adaptador MCP contra una base real:
//
//   1. Un miembro canjea su sesion por un token MCP (M-3).
//   2. `tools/list` por MCP no incluye tools sensibles (M-6) ni exige que la
//      comunidad viaje como argumento (M-5).
//   3. `tools/call` ejecuta una tool de lectura y deja auditoria `mcp.tool_call`
//      (M-8).
//   4. Perder la pertenencia invalida el token aunque su firma siga siendo
//      valida (revocacion por pertenencia, no por firma).
//   5. GET sobre el endpoint no esta permitido.
// ---------------------------------------------------------------------------

import request from 'supertest'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { admin } from '../db-admin.js'
import {
  createUser,
  deleteCommunity,
  deleteUser,
  makeAdmin,
  makeCommunity,
  makeMember,
  app,
  type TestUser,
} from './helpers.js'

const V1 = '/api/v1'
const MCP = `${V1}/mcp`

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
  const res = await request(app())
    .post(`${V1}/auth/login`)
    .send({ email: user.email, password: user.password })
  expect(res.status).toBe(200)
  return `Bearer ${res.body.data.accessToken}`
}

async function mcpSession(token: string, communityId: string): Promise<string> {
  const res = await request(app())
    .post(`${MCP}/sessions`)
    .set('Authorization', token)
    .send({ communityId })
  expect(res.status).toBe(201)
  return res.body.data.token as string
}

function rpc(mcpToken: string, method: string, params: unknown = {}): request.Test {
  return request(app())
    .post(MCP)
    .set('Authorization', `Bearer ${mcpToken}`)
    .set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, method, params })
}

describe('MCP · alta de sesion', () => {
  it('un miembro canjea su sesion por un token MCP', async () => {
    const comunidad = await makeCommunity('MCP sesion')
    comunidades.push(comunidad)
    const user = await createUser({ fullName: 'Admin MCP' })
    usuarios.push(user.id)
    await makeAdmin(user.id, comunidad)

    const res = await request(app())
      .post(`${MCP}/sessions`)
      .set('Authorization', await tokenDe(user))
      .send({ communityId: comunidad })

    expect(res.status).toBe(201)
    expect(res.body.data.token).toEqual(expect.any(String))
    expect(res.body.data.role).toBe('ADMIN')
  })

  it('alguien de fuera no puede pedir token para la comunidad', async () => {
    const comunidad = await makeCommunity('MCP ajena')
    comunidades.push(comunidad)
    const outsider = await createUser({ fullName: 'De fuera' })
    usuarios.push(outsider.id)

    const res = await request(app())
      .post(`${MCP}/sessions`)
      .set('Authorization', await tokenDe(outsider))
      .send({ communityId: comunidad })

    expect(res.status).toBe(403)
  })

  it('sin access token, 401', async () => {
    const res = await request(app()).post(`${MCP}/sessions`).send({ communityId: 'x' })
    expect(res.status).toBe(401)
  })
})

describe('MCP · tools', () => {
  it('tools/list no expone tools sensibles y tools/call deja auditoria', async () => {
    const comunidad = await makeCommunity('Comunidad del Saucejo MCP')
    comunidades.push(comunidad)
    const user = await createUser({ fullName: 'Admin tools' })
    usuarios.push(user.id)
    await makeAdmin(user.id, comunidad)

    const token = await mcpSession(await tokenDe(user), comunidad)

    const lista = await rpc(token, 'tools/list')
    expect(lista.status).toBe(200)
    const nombres = (lista.body.result.tools as Array<{ name: string }>).map((t) => t.name)
    expect(nombres).toContain('get_community')
    expect(nombres).toContain('get_weather')
    expect(nombres).not.toContain('get_expenses')
    expect(nombres).not.toContain('prepare_incident_draft')

    const llamada = await rpc(token, 'tools/call', { name: 'get_community', arguments: {} })
    expect(llamada.status).toBe(200)
    expect(llamada.body.error).toBeUndefined()
    const texto = (llamada.body.result.content as Array<{ text: string }>)[0]?.text ?? ''
    expect(texto).toContain('Comunidad del Saucejo MCP')

    const auditoria = await admin.auditLogs.findMany({
      where: { community_id: comunidad, action: 'mcp.tool_call' },
    })
    expect(auditoria).toHaveLength(1)
    expect(auditoria[0]?.agent_name).toBe('mcp')
    expect(auditoria[0]?.entity_id).toBe('get_community')
  })

  it('una tool sensible no esta disponible: tools/call responde error', async () => {
    const comunidad = await makeCommunity('MCP sensible')
    comunidades.push(comunidad)
    const user = await createUser({ fullName: 'Admin sensible' })
    usuarios.push(user.id)
    await makeAdmin(user.id, comunidad)

    const token = await mcpSession(await tokenDe(user), comunidad)
    const res = await rpc(token, 'tools/call', { name: 'get_expenses', arguments: {} })
    expect(res.body.result?.isError, JSON.stringify(res.body)).toBe(true)
  })

  it('sin token MCP, 401', async () => {
    const res = await request(app())
      .post(MCP)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    expect(res.status).toBe(401)
  })

  it('GET no esta permitido', async () => {
    const comunidad = await makeCommunity('MCP get')
    comunidades.push(comunidad)
    const user = await createUser({ fullName: 'Admin get' })
    usuarios.push(user.id)
    await makeAdmin(user.id, comunidad)
    const token = await mcpSession(await tokenDe(user), comunidad)

    const res = await request(app()).get(MCP).set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(405)
  })

  it('al perder la pertenencia, el token MCP deja de valer', async () => {
    const comunidad = await makeCommunity('MCP revocacion')
    comunidades.push(comunidad)
    const user = await createUser({ fullName: 'Admin revocable' })
    usuarios.push(user.id)
    await makeMember(user.id, comunidad, 'NEIGHBOR')

    const token = await mcpSession(await tokenDe(user), comunidad)

    const miembro = await admin.communityMembers.findUnique({
      where: { community_id_user_id: { community_id: comunidad, user_id: user.id } },
    })
    if (miembro) await admin.communityMembers.delete({ where: { id: miembro.id } })

    const res = await rpc(token, 'tools/list')
    expect(res.status).toBe(401)
  })
})
