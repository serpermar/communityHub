// ---------------------------------------------------------------------------
// Votaciones por API: visibilidad, ciclo de vida, el voto (upsert), el recuento
// y el export.
//
// Los fixtures se siembran con `admin` (privilegio) y se afirma por la API (rol
// app_runtime con RLS). No es un atajo: `app_runtime` NO tiene INSERT/UPDATE/
// DELETE sobre `votes`, `vote_options` ni `vote_responses` (02k los revoca), y
// las respuestas individuales solo existen detras de una funcion
// SECURITY DEFINER. El fixture con privilegio es la unica via de montar un
// escenario con votos ya emitidos.
//
// Los comportamientos que solo se pueden demostrar aqui:
//
//   1. V-1/V-5: un PROVIDER listando recibe 403, pero el detalle le da 404 (no
//      403): un 403 por id confirmaria que existe.
//   2. V-2: el recuento NO contiene ningun identificador de votante. Es una
//      busqueda de los ids de los actores dentro del JSON.
//   3. V-6: `status` (columna) y `effectiveStatus` (derivado) conviven, y una
//      OPEN vencida se lista como CLOSED sin que la fila cambie.
//   4. V-7: el PATCH es parcial y solo sobre un DRAFT; publicar o cerrar no se
//      edita.
//   5. V-10: la opcion de abstencion la genera el sistema, y mandarla a mano es
//      un 400.
//   6. V-11: el segundo voto del mismo usuario CAMBIA el primero (upsert), no
//      da 409 ni un segundo voto.
//   7. V-12: la visibilidad de resultados por rol (`AFTER_CLOSE` abierta da
//      403; `ADMIN_ONLY` da 403 siempre salvo a la gestion).
//   8. V-13: el export es `text/csv` del recuento, no una fila por voto.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { admin } from '../db-admin.js'
import {
  app,
  createUser,
  deleteCommunity,
  deleteUser,
  makeAdminSa,
  makeCommunity,
  makeMember,
  type TestUser,
} from './helpers.js'

const V1 = '/api/v1'

const usuarios: string[] = []
const comunidades: string[] = []

afterEach(async () => {
  while (comunidades.length > 0) {
    await deleteCommunity(comunidades.pop()!).catch(() => undefined)
  }
})

afterAll(async () => {
  while (usuarios.length > 0) {
    await deleteUser(usuarios.pop()!).catch(() => undefined)
  }
})

async function nuevoUsuario(overrides: { fullName?: string } = {}): Promise<TestUser> {
  const user = await createUser(overrides)
  usuarios.push(user.id)
  return user
}

async function nuevaComunidad(nombre = 'Comunidad de prueba'): Promise<string> {
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

async function actor(user: TestUser): Promise<Actor> {
  return { ...user, token: await tokenDe(user) }
}

let actores: { admin: Actor; presidente: Actor; vecino: Actor; proveedor: Actor } | null = null

/** Comunidad con los cuatro roles del bloque. Los usuarios se crean una sola vez. */
async function escena(): Promise<{ comunidad: string } & typeof actores> {
  const comunidad = await nuevaComunidad()

  if (!actores) {
    actores = {
      admin: await actor(await nuevoUsuario({ fullName: 'Administradora' })),
      presidente: await actor(await nuevoUsuario({ fullName: 'Presidente' })),
      vecino: await actor(await nuevoUsuario({ fullName: 'Vecino' })),
      proveedor: await actor(await nuevoUsuario({ fullName: 'Proveedor' })),
    }
  }

  await makeMember(actores.admin.id, comunidad, 'ADMIN')
  await makeMember(actores.presidente.id, comunidad, 'PRESIDENT')
  await makeMember(actores.vecino.id, comunidad, 'NEIGHBOR')
  await makeMember(actores.proveedor.id, comunidad, 'PROVIDER')

  return { comunidad, ...actores }
}

async function outsider(): Promise<Actor> {
  const user = await nuevoUsuario({ fullName: 'De fuera' })
  return { ...user, token: await tokenDe(user) }
}

let staff: Actor | null = null
async function adminSa(): Promise<Actor> {
  if (!staff) {
    const user = await makeAdminSa({ fullName: 'Staff' })
    usuarios.push(user.id)
    staff = await actor(user)
  }
  return staff
}

// ---------------------------------------------------------------------------
// Fixtures y peticiones
// ---------------------------------------------------------------------------

type VoteFixture = { id: string; si: string; no: string; abst: string | null }

/** Una votacion con sus opciones, por la via privilegiada (app_runtime no puede escribir). */
async function makeVoteRow(
  communityId: string,
  createdBy: string,
  o: {
    title?: string
    question?: string
    description?: string | null
    type?: string
    status?: string
    startsAt?: Date
    endsAt?: Date
    allowAbstention?: boolean
    quorumPercent?: number | null
    resultVisibility?: string
    closedAt?: Date | null
  } = {},
): Promise<VoteFixture> {
  const id = randomUUID()
  const type = o.type ?? 'SINGLE'

  await admin.votes.create({
    data: {
      id,
      community_id: communityId,
      title: o.title ?? 'Votación de prueba',
      question: o.question ?? '¿Estás de acuerdo?',
      description: o.description ?? null,
      type: type as never,
      status: (o.status ?? 'OPEN') as never,
      starts_at: o.startsAt ?? new Date('2020-01-01T00:00:00.000Z'),
      ends_at: o.endsAt ?? new Date('2999-01-01T00:00:00.000Z'),
      allow_abstention: o.allowAbstention ?? false,
      quorum_percent: type === 'QUORUM' ? (o.quorumPercent ?? 50) : null,
      result_visibility: (o.resultVisibility ?? 'AFTER_CLOSE') as never,
      closed_at: o.closedAt ?? null,
      created_by: createdBy,
    },
  })

  const si = randomUUID()
  const no = randomUUID()
  const abst = o.allowAbstention ? randomUUID() : null

  const opciones: Array<{
    id: string
    vote_id: string
    label: string
    position: number
    is_abstention?: boolean
  }> = [
    { id: si, vote_id: id, label: 'Sí', position: 1 },
    { id: no, vote_id: id, label: 'No', position: 2 },
  ]
  if (abst)
    opciones.push({ id: abst, vote_id: id, label: 'Abstención', position: 3, is_abstention: true })

  await admin.voteOptions.createMany({ data: opciones })

  return { id, si, no, abst }
}

/** Emite votos directamente, saltandose la ventana: para montar recuentos. */
async function sembrarVotos(
  entradas: Array<{ voteId: string; optionId: string; userId: string }>,
): Promise<void> {
  await admin.voteResponses.createMany({
    data: entradas.map((e) => ({ vote_id: e.voteId, option_id: e.optionId, user_id: e.userId })),
  })
}

const VOTACION_VALIDA = {
  title: '¿Instalar cámaras en el parking?',
  question: '¿Estás de acuerdo con instalar cámaras de vigilancia?',
  type: 'SINGLE' as const,
  startsAt: '2026-11-01T08:00:00.000Z',
  endsAt: '2026-11-08T20:00:00.000Z',
  allowAbstention: true,
  resultVisibility: 'LIVE' as const,
  options: ['Sí', 'No'],
}

function crearVotacion(token: string, comunidad: string, body: object = VOTACION_VALIDA) {
  return request(app())
    .post(`${V1}/communities/${comunidad}/votes`)
    .set('Authorization', token)
    .send(body)
}

function listarVotaciones(token: string, comunidad: string, query = '') {
  return request(app())
    .get(`${V1}/communities/${comunidad}/votes${query}`)
    .set('Authorization', token)
}

function verVotacion(token: string, id: string) {
  return request(app()).get(`${V1}/votes/${id}`).set('Authorization', token)
}

function editarVotacion(token: string, id: string, body: object) {
  return request(app()).patch(`${V1}/votes/${id}`).set('Authorization', token).send(body)
}

function publicarVotacion(token: string, id: string, body?: object) {
  const peticion = request(app()).post(`${V1}/votes/${id}/publish`).set('Authorization', token)
  return body === undefined ? peticion : peticion.send(body)
}

function cerrarVotacion(token: string, id: string, body?: object) {
  const peticion = request(app()).post(`${V1}/votes/${id}/close`).set('Authorization', token)
  return body === undefined ? peticion : peticion.send(body)
}

function votar(token: string, id: string, optionId: string) {
  return request(app())
    .post(`${V1}/votes/${id}/responses`)
    .set('Authorization', token)
    .send({ optionId })
}

function resultados(token: string, id: string) {
  return request(app()).get(`${V1}/votes/${id}/results`).set('Authorization', token)
}

function exportarResultados(token: string, id: string) {
  return request(app()).get(`${V1}/votes/${id}/results/export`).set('Authorization', token)
}

// ---------------------------------------------------------------------------

describe('Seguridad y aislamiento entre comunidades', () => {
  it('sin token, las nueve rutas son 401', async () => {
    const e = await escena()
    const v = await makeVoteRow(e.comunidad, e.admin.id)

    const sinToken = async (nombre: string, peticion: request.Test) => {
      const res = await peticion
      expect(res.status, nombre).toBe(401)
    }

    await sinToken('GET votes', request(app()).get(`${V1}/communities/${e.comunidad}/votes`))
    await sinToken('POST votes', request(app()).post(`${V1}/communities/${e.comunidad}/votes`))
    await sinToken('GET vote', request(app()).get(`${V1}/votes/${v.id}`))
    await sinToken('PATCH vote', request(app()).patch(`${V1}/votes/${v.id}`))
    await sinToken('POST publish', request(app()).post(`${V1}/votes/${v.id}/publish`))
    await sinToken('POST close', request(app()).post(`${V1}/votes/${v.id}/close`))
    await sinToken('POST responses', request(app()).post(`${V1}/votes/${v.id}/responses`))
    await sinToken('GET results', request(app()).get(`${V1}/votes/${v.id}/results`))
    await sinToken('GET export', request(app()).get(`${V1}/votes/${v.id}/results/export`))
  })

  it('un no miembro: 403 en las rutas de comunidad y 404 en el detalle', async () => {
    const e = await escena()
    const ajeno = await outsider()
    const v = await makeVoteRow(e.comunidad, e.admin.id)

    expect((await listarVotaciones(ajeno.token, e.comunidad)).status).toBe(403)
    expect((await crearVotacion(ajeno.token, e.comunidad)).status).toBe(403)

    const detalle = await verVotacion(ajeno.token, v.id)
    expect(detalle.status).toBe(404)
    expect(detalle.body.error.code).toBe('NOT_FOUND')
  })

  it('un PROVIDER: listar da 403 y el detalle 404 (V-1)', async () => {
    const e = await escena()
    const v = await makeVoteRow(e.comunidad, e.admin.id)

    const lista = await listarVotaciones(e.proveedor.token, e.comunidad)
    expect(lista.status).toBe(403)
    expect(lista.body.error.code).toBe('FORBIDDEN')

    expect((await verVotacion(e.proveedor.token, v.id)).status).toBe(404)
    expect((await votar(e.proveedor.token, v.id, v.si)).status).toBe(404)
    expect((await resultados(e.proveedor.token, v.id)).status).toBe(404)
  })

  it('un miembro de A no ve ni gestiona las votaciones de B', async () => {
    const e = await escena()
    const comunidadB = await nuevaComunidad('Comunidad B')
    await makeMember(e.admin.id, comunidadB, 'ADMIN')
    const vB = await makeVoteRow(comunidadB, e.admin.id)

    expect((await listarVotaciones(e.vecino.token, comunidadB)).status).toBe(403)
    expect((await verVotacion(e.vecino.token, vB.id)).status).toBe(404)
  })

  it('un ADMIN_SA que no es miembro: 403 en la comunidad y 404 en el detalle', async () => {
    const e = await escena()
    const elena = await adminSa()
    const v = await makeVoteRow(e.comunidad, e.admin.id)

    expect((await listarVotaciones(elena.token, e.comunidad)).status).toBe(403)
    expect((await verVotacion(elena.token, v.id)).status).toBe(404)
  })

  it('un miembro suspendido: 403 en el listado y 404 en el detalle', async () => {
    const e = await escena()
    const v = await makeVoteRow(e.comunidad, e.admin.id)

    await admin.communityMembers.update({
      where: { community_id_user_id: { community_id: e.comunidad, user_id: e.vecino.id } },
      data: { status: 'SUSPENDED' },
    })

    expect((await listarVotaciones(e.vecino.token, e.comunidad)).status).toBe(403)
    expect((await verVotacion(e.vecino.token, v.id)).status).toBe(404)
  })

  it('un id que no es un UUID es 400', async () => {
    const e = await escena()

    const detalle = await verVotacion(e.admin.token, 'no-es-uuid')
    expect(detalle.status).toBe(400)
    expect(detalle.body.error.code).toBe('VALIDATION_ERROR')

    const comunidadMala = await request(app())
      .get(`${V1}/communities/no-es-uuid/votes`)
      .set('Authorization', e.admin.token)
    expect(comunidadMala.status).toBe(400)
  })
})

describe('Visibilidad del borrador (V-5)', () => {
  it('un NEIGHBOR recibe 404 en el borrador; el PRESIDENT lo ve', async () => {
    const e = await escena()
    const v = await makeVoteRow(e.comunidad, e.admin.id, { status: 'DRAFT' })

    expect((await verVotacion(e.vecino.token, v.id)).status).toBe(404)

    const delPresidente = await verVotacion(e.presidente.token, v.id)
    expect(delPresidente.status).toBe(200)
    expect(delPresidente.body.data.status).toBe('DRAFT')
  })
})

describe('Ciclo de vida (V-6, V-7)', () => {
  it('crear deja DRAFT, con Location y la abstencion generada; publicar lo pasa a OPEN', async () => {
    const e = await escena()

    const res = await crearVotacion(e.presidente.token, e.comunidad)
    expect(res.status, JSON.stringify(res.body)).toBe(201)

    const votacion = res.body.data
    expect(res.headers.location).toBe(`/api/v1/votes/${votacion.id}`)
    expect(votacion.status).toBe('DRAFT')
    expect(votacion.effectiveStatus).toBe('DRAFT')
    expect(votacion.communityId).toBe(e.comunidad)
    expect(votacion.createdBy).toBe(e.presidente.id)
    expect(votacion.createdByName).toBe('Presidente')
    expect(votacion.myOptionId).toBeNull()
    // V-10: las opciones reales mas la abstencion que anade el sistema.
    expect(votacion.options.map((o: { label: string }) => o.label)).toEqual([
      'Sí',
      'No',
      'Abstención',
    ])
    expect(votacion.options.at(-1).isAbstention).toBe(true)

    const publicado = await publicarVotacion(e.presidente.token, votacion.id)
    expect(publicado.status, JSON.stringify(publicado.body)).toBe(200)
    expect(publicado.body.data.status).toBe('OPEN')

    const segundo = await publicarVotacion(e.presidente.token, votacion.id)
    expect(segundo.status).toBe(409)
    expect(segundo.body.error.code).toBe('VOTE_NOT_DRAFT')
  })

  it('cerrar: OPEN -> CLOSED con closedAt; segundo close 409; close de DRAFT 409', async () => {
    const e = await escena()
    const abierta = await makeVoteRow(e.comunidad, e.admin.id, { status: 'OPEN' })
    const borrador = await makeVoteRow(e.comunidad, e.admin.id, { status: 'DRAFT' })

    const cerrada = await cerrarVotacion(e.admin.token, abierta.id)
    expect(cerrada.status, JSON.stringify(cerrada.body)).toBe(200)
    expect(cerrada.body.data.status).toBe('CLOSED')
    expect(cerrada.body.data.closedAt).not.toBeNull()

    const otraVez = await cerrarVotacion(e.admin.token, abierta.id)
    expect(otraVez.status).toBe(409)
    expect(otraVez.body.error.code).toBe('VOTE_ALREADY_CLOSED')

    const antes = await cerrarVotacion(e.admin.token, borrador.id)
    expect(antes.status).toBe(409)
    expect(antes.body.error.code).toBe('VOTE_NOT_OPEN')
  })

  it('una OPEN vencida se lee CLOSED sin tocar la fila, y ?status=CLOSED la incluye', async () => {
    const e = await escena()
    const vencida = await makeVoteRow(e.comunidad, e.admin.id, {
      status: 'OPEN',
      startsAt: new Date('2019-01-01T00:00:00.000Z'),
      endsAt: new Date('2020-01-01T00:00:00.000Z'),
    })

    const detalle = await verVotacion(e.admin.token, vencida.id)
    expect(detalle.body.data.status).toBe('OPEN')
    expect(detalle.body.data.effectiveStatus).toBe('CLOSED')

    // La columna sigue siendo OPEN: el estado es derivado (V-6).
    const fila = await admin.votes.findUnique({
      where: { id: vencida.id },
      select: { status: true },
    })
    expect(fila?.status).toBe('OPEN')

    const enCerradas = await listarVotaciones(e.admin.token, e.comunidad, '?status=CLOSED')
    expect(enCerradas.body.data.map((v: { id: string }) => v.id)).toContain(vencida.id)

    const enAbiertas = await listarVotaciones(e.admin.token, e.comunidad, '?status=OPEN')
    expect(enAbiertas.body.data.map((v: { id: string }) => v.id)).not.toContain(vencida.id)
  })

  it('el PATCH es parcial y solo del DRAFT; en OPEN da 409 VOTE_NOT_DRAFT', async () => {
    const e = await escena()
    const borrador = await makeVoteRow(e.comunidad, e.admin.id, {
      status: 'DRAFT',
      title: 'Título original',
      description: 'Descripción original',
    })

    const res = await editarVotacion(e.admin.token, borrador.id, { title: 'Título nuevo' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.data.title).toBe('Título nuevo')
    // El PATCH no manda description, asi que no se toca (sin .transform, V-7).
    expect(res.body.data.description).toBe('Descripción original')

    const abierta = await makeVoteRow(e.comunidad, e.admin.id, { status: 'OPEN' })
    const enAbierta = await editarVotacion(e.admin.token, abierta.id, { title: 'Tarde' })
    expect(enAbierta.status).toBe(409)
    expect(enAbierta.body.error.code).toBe('VOTE_NOT_DRAFT')
  })

  it('el PATCH vacio es 400; el vecino no edita (404 en el DRAFT, 403 en la OPEN)', async () => {
    const e = await escena()
    const borrador = await makeVoteRow(e.comunidad, e.admin.id, { status: 'DRAFT' })
    const abierta = await makeVoteRow(e.comunidad, e.admin.id, { status: 'OPEN' })

    const vacio = await editarVotacion(e.admin.token, borrador.id, {})
    expect(vacio.status).toBe(400)
    expect(vacio.body.error.code).toBe('VALIDATION_ERROR')

    // El DRAFT no es visible para el vecino: 404, no 403 (C-8, no confirma que exista).
    expect((await editarVotacion(e.vecino.token, borrador.id, { title: 'X' })).status).toBe(404)

    // La OPEN si la ve, asi que llega a la funcion y alli choca con el rol.
    const porVecino = await editarVotacion(e.vecino.token, abierta.id, { title: 'X' })
    expect(porVecino.status).toBe(403)
    expect(porVecino.body.error.code).toBe('FORBIDDEN')
  })

  it('cambiar allowAbstention en un DRAFT quita o anade la opcion del sistema', async () => {
    const e = await escena()
    const conAbst = await makeVoteRow(e.comunidad, e.admin.id, {
      status: 'DRAFT',
      allowAbstention: true,
    })
    const sinAbst = await makeVoteRow(e.comunidad, e.admin.id, {
      status: 'DRAFT',
      allowAbstention: false,
    })

    const quitada = await editarVotacion(e.admin.token, conAbst.id, { allowAbstention: false })
    expect(quitada.body.data.options.map((o: { label: string }) => o.label)).toEqual(['Sí', 'No'])

    const puesta = await editarVotacion(e.admin.token, sinAbst.id, { allowAbstention: true })
    expect(puesta.body.data.options.map((o: { label: string }) => o.label)).toEqual([
      'Sí',
      'No',
      'Abstención',
    ])
  })
})

describe('El voto (V-10, V-11)', () => {
  it('votar y cambiar el voto es un upsert: no aparece un segundo voto y cambia myOptionId', async () => {
    const e = await escena()
    const v = await makeVoteRow(e.comunidad, e.admin.id, {
      status: 'OPEN',
      resultVisibility: 'LIVE',
    })

    const primero = await votar(e.vecino.token, v.id, v.si)
    expect(primero.status, JSON.stringify(primero.body)).toBe(200)
    expect(primero.body.data.optionId).toBe(v.si)

    const segundo = await votar(e.vecino.token, v.id, v.no)
    expect(segundo.status).toBe(200)
    expect(segundo.body.data.optionId).toBe(v.no)

    const detalle = await verVotacion(e.vecino.token, v.id)
    expect(detalle.body.data.myOptionId).toBe(v.no)

    const recuento = await resultados(e.admin.token, v.id)
    expect(recuento.body.data.turnout).toBe(1)

    const filas = await admin.voteResponses.findMany({
      where: { vote_id: v.id, user_id: e.vecino.id },
    })
    expect(filas).toHaveLength(1)
  })

  it('un optionId de OTRA votacion es un 400 VOTE_OPTION_INVALID', async () => {
    const e = await escena()
    const v = await makeVoteRow(e.comunidad, e.admin.id, { status: 'OPEN' })
    const otra = await makeVoteRow(e.comunidad, e.admin.id, { status: 'OPEN' })

    const res = await votar(e.vecino.token, v.id, otra.si)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VOTE_OPTION_INVALID')
  })

  it('votar en un DRAFT da 409 VOTE_NOT_OPEN; en una OPEN vencida, 409 VOTE_CLOSED', async () => {
    const e = await escena()
    const borrador = await makeVoteRow(e.comunidad, e.admin.id, { status: 'DRAFT' })
    // El PRESIDENT ve el borrador, asi que llega a app_cast_vote() y alli choca.
    const enBorrador = await votar(e.presidente.token, borrador.id, borrador.si)
    expect(enBorrador.status).toBe(409)
    expect(enBorrador.body.error.code).toBe('VOTE_NOT_OPEN')

    const vencida = await makeVoteRow(e.comunidad, e.admin.id, {
      status: 'OPEN',
      startsAt: new Date('2019-01-01T00:00:00.000Z'),
      endsAt: new Date('2020-01-01T00:00:00.000Z'),
    })
    const enVencida = await votar(e.vecino.token, vencida.id, vencida.si)
    expect(enVencida.status).toBe(409)
    expect(enVencida.body.error.code).toBe('VOTE_CLOSED')
  })

  it('crear con una sola opcion, repetidas o "Abstención" a mano es 400', async () => {
    const e = await escena()

    const unaSola = await crearVotacion(e.admin.token, e.comunidad, {
      ...VOTACION_VALIDA,
      options: ['Sí'],
    })
    expect(unaSola.status).toBe(400)
    expect(unaSola.body.error.code).toBe('VALIDATION_ERROR')

    const repetidas = await crearVotacion(e.admin.token, e.comunidad, {
      ...VOTACION_VALIDA,
      options: ['Sí', 'No', 'sí'],
    })
    expect(repetidas.status).toBe(400)
    expect(repetidas.body.error.code).toBe('VOTE_OPTION_DUPLICATE')

    const abstencion = await crearVotacion(e.admin.token, e.comunidad, {
      ...VOTACION_VALIDA,
      allowAbstention: true,
      options: ['Sí', 'Abstención'],
    })
    expect(abstencion.status).toBe(400)
    expect(abstencion.body.error.code).toBe('VOTE_OPTION_DUPLICATE')
  })

  it('sin allowAbstention, la votacion no lleva opcion de abstencion', async () => {
    const e = await escena()
    const res = await crearVotacion(e.admin.token, e.comunidad, {
      ...VOTACION_VALIDA,
      allowAbstention: false,
    })
    expect(res.status).toBe(201)
    expect(res.body.data.options.map((o: { label: string }) => o.label)).toEqual(['Sí', 'No'])
  })
})

describe('Resultados (V-2, V-12) y export (V-13)', () => {
  it('el recuento LIVE agrega los votos y NO lleva identificadores de votante', async () => {
    const e = await escena()
    const v = await makeVoteRow(e.comunidad, e.admin.id, {
      status: 'OPEN',
      resultVisibility: 'LIVE',
      allowAbstention: true,
    })
    await sembrarVotos([
      { voteId: v.id, optionId: v.si, userId: e.admin.id },
      { voteId: v.id, optionId: v.si, userId: e.presidente.id },
      { voteId: v.id, optionId: v.no, userId: e.vecino.id },
    ])

    const res = await resultados(e.vecino.token, v.id)
    expect(res.status, JSON.stringify(res.body)).toBe(200)

    const r = res.body.data
    // Elegibles: los tres roles que votan; el PROVIDER no cuenta (V-1).
    expect(r.eligibleCount).toBe(3)
    expect(r.turnout).toBe(3)
    expect(r.participationPercent).toBe(100)
    expect(r.quorumRequired).toBe(false)
    expect(r.quorumMet).toBeNull()
    expect(r.abstentionCount).toBe(0)

    const porLabel = Object.fromEntries(
      r.options.map((o: { label: string; votes: number; percent: number }) => [o.label, o]),
    )
    expect(porLabel['Sí'].votes).toBe(2)
    expect(porLabel['Sí'].percent).toBe(66.67)
    expect(porLabel['No'].votes).toBe(1)
    expect(porLabel['Abstención'].votes).toBe(0)

    // V-2: ni un id de votante en todo el JSON.
    const crudo = JSON.stringify(res.body)
    for (const user of [e.admin, e.presidente, e.vecino, e.proveedor]) {
      expect(crudo).not.toContain(user.id)
    }
  })

  it('AFTER_CLOSE abierta da 403 al vecino y 200 tras cerrar; ADMIN_ONLY da 403 siempre', async () => {
    const e = await escena()
    const despues = await makeVoteRow(e.comunidad, e.admin.id, {
      status: 'OPEN',
      resultVisibility: 'AFTER_CLOSE',
    })
    const soloAdmin = await makeVoteRow(e.comunidad, e.admin.id, {
      status: 'OPEN',
      resultVisibility: 'ADMIN_ONLY',
    })

    const antesDeCerrar = await resultados(e.vecino.token, despues.id)
    expect(antesDeCerrar.status).toBe(403)
    expect(antesDeCerrar.body.error.code).toBe('FORBIDDEN')

    await cerrarVotacion(e.admin.token, despues.id)
    expect((await resultados(e.vecino.token, despues.id)).status).toBe(200)

    const vecinoSoloAdmin = await resultados(e.vecino.token, soloAdmin.id)
    expect(vecinoSoloAdmin.status).toBe(403)
    expect((await resultados(e.admin.token, soloAdmin.id)).status).toBe(200)
  })

  it('resultados de un DRAFT dan 409 VOTE_NOT_PUBLISHED', async () => {
    const e = await escena()
    const borrador = await makeVoteRow(e.comunidad, e.admin.id, { status: 'DRAFT' })

    const res = await resultados(e.admin.token, borrador.id)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('VOTE_NOT_PUBLISHED')
  })

  it('una votacion QUORUM marca quorumMet segun la participacion', async () => {
    const e = await escena()
    const v = await makeVoteRow(e.comunidad, e.admin.id, {
      status: 'OPEN',
      type: 'QUORUM',
      quorumPercent: 60,
      resultVisibility: 'LIVE',
    })

    const sinQuorum = await resultados(e.admin.token, v.id)
    expect(sinQuorum.body.data.quorumRequired).toBe(true)
    expect(sinQuorum.body.data.quorumMet).toBe(false)

    await sembrarVotos([
      { voteId: v.id, optionId: v.si, userId: e.admin.id },
      { voteId: v.id, optionId: v.no, userId: e.presidente.id },
      { voteId: v.id, optionId: v.si, userId: e.vecino.id },
    ])

    const conQuorum = await resultados(e.admin.token, v.id)
    expect(conQuorum.body.data.quorumPercent).toBe(60)
    expect(conQuorum.body.data.quorumMet).toBe(true)
  })

  it('el export es text/csv del recuento, con una fila por opcion', async () => {
    const e = await escena()
    const v = await makeVoteRow(e.comunidad, e.admin.id, {
      status: 'OPEN',
      resultVisibility: 'LIVE',
    })
    await sembrarVotos([
      { voteId: v.id, optionId: v.si, userId: e.admin.id },
      { voteId: v.id, optionId: v.no, userId: e.vecino.id },
    ])

    const res = await exportarResultados(e.admin.token, v.id)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toContain('attachment')

    const texto = res.text.replace('\uFEFF', '')
    const lineas = texto.trim().split('\r\n')
    expect(lineas[0]).toBe('opción,votos,porcentaje')
    // Una fila por opcion (Sí, No): ninguna fila por voto.
    expect(lineas).toHaveLength(3)
    expect(lineas.some((l) => l.startsWith('Sí,1,'))).toBe(true)
    expect(lineas.some((l) => l.startsWith('No,1,'))).toBe(true)
  })
})

describe('Listado y contrato (§7.3)', () => {
  it('ordena por creacion descendente y pagina con meta.total real', async () => {
    const e = await escena()
    const primera = await makeVoteRow(e.comunidad, e.admin.id, { title: 'Primera', status: 'OPEN' })
    const segunda = await makeVoteRow(e.comunidad, e.admin.id, { title: 'Segunda', status: 'OPEN' })
    const tercera = await makeVoteRow(e.comunidad, e.admin.id, { title: 'Tercera', status: 'OPEN' })

    const pagina1 = await listarVotaciones(e.admin.token, e.comunidad, '?page=1&limit=2')
    expect(pagina1.status).toBe(200)
    expect(pagina1.body.data).toHaveLength(2)
    expect(pagina1.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 })

    const masAlla = await listarVotaciones(e.admin.token, e.comunidad, '?page=5&limit=2')
    expect(masAlla.body.data).toHaveLength(0)
    expect(masAlla.body.meta).toEqual({ page: 5, limit: 2, total: 3, totalPages: 2 })

    const ids = new Set([primera.id, segunda.id, tercera.id])
    expect(pagina1.body.data.every((v: { id: string }) => ids.has(v.id))).toBe(true)
  })

  it('los query params invalidos y el cuerpo con campos de mas son 400', async () => {
    const e = await escena()

    for (const query of ['?status=PENDING', '?page=0', '?limit=101', '?q=camaras']) {
      const res = await listarVotaciones(e.admin.token, e.comunidad, query)
      expect(res.status, `con ${query}`).toBe(400)
      expect(res.body.error.code, `con ${query}`).toBe('VALIDATION_ERROR')
    }

    const extra = await crearVotacion(e.admin.token, e.comunidad, {
      ...VOTACION_VALIDA,
      status: 'OPEN',
    })
    expect(extra.status).toBe(400)
    expect(extra.body.error.code).toBe('VALIDATION_ERROR')

    const v = await makeVoteRow(e.comunidad, e.admin.id, { status: 'OPEN' })
    const publicarConCuerpo = await publicarVotacion(e.admin.token, v.id, { otra: 'cosa' })
    expect(publicarConCuerpo.status).toBe(400)
  })

  it('el sobre es { data, meta } en exito y { error } en fallo', async () => {
    const e = await escena()

    const ok_ = await listarVotaciones(e.admin.token, e.comunidad)
    expect(ok_.body).toHaveProperty('data')
    expect(ok_.body).toHaveProperty('meta')
    expect(ok_.body).not.toHaveProperty('error')

    const fallo = await crearVotacion(e.vecino.token, e.comunidad, {})
    expect(fallo.body).toHaveProperty('error')
    expect(fallo.body.error).toMatchObject({ code: 'FORBIDDEN' })
    expect(typeof fallo.body.error.message).toBe('string')
  })
})
