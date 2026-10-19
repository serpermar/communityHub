// ---------------------------------------------------------------------------
// Finanzas por API: seguridad, el ADMIN-unico (FN-1), gastos, facturas, el
// vinculo gasto<->factura (FN-10), el resumen y los filtros.
//
// Los fixtures se siembran con `admin` (privilegio) y se afirma por la API (rol
// app_runtime con RLS). Las lecturas con privilegio se reducen a los dos sitios
// donde la API no podria demostrar nada: el `deleted_at` tras el soft delete de
// un gasto y el estado real de una factura que el driver no deberia dejar leer a
// un no-ADMIN.
//
// Los comportamientos que solo pueden demostrarse aqui:
//
//   1. FN-1: el bloque ES solo de ADMIN, listar incluido. Un PRESIDENT recibe
//      403 en las seis rutas de comunidad y 404 en el gasto por id (C-8), no
//      403: un 403 confirmaria que el id existe.
//   2. FN-5/FN-14: `status` (guardado) y `effectiveStatus` (derivado) conviven, y
//      `?status=OVERDUE` filtra por el efectivo sin que exista la fila 'OVERDUE'.
//   3. FN-6: pagar dos veces es un 409 INVOICE_ALREADY_PAID, no un 200 idempotente.
//   4. FN-10: un gasto con la factura de OTRA comunidad es un 400
//      EXPENSE_INVOICE_MISMATCH (codigo propio, no VALIDATION_ERROR).
//   5. FN-12: el numero de factura repetido es un 409 INVOICE_NUMBER_TAKEN.
//   6. FN-9: `amount` sale como numero en el JSON, no como el string del numeric.
//   7. FN-7/FN-8: el PUT es reemplazo completo (limpiar = null) y el DELETE es
//      soft (el segundo es 404, no un 200 idempotente).
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

/** Un gasto por la via privilegiada, para montar escenarios sin depender de la API. */
async function makeExpenseRow(
  communityId: string,
  createdBy: string,
  overrides: {
    concept?: string
    category?: string
    amount?: string
    expenseDate?: Date
    supplier?: string | null
    invoiceId?: string | null
  } = {},
): Promise<string> {
  const id = randomUUID()
  await admin.expenses.create({
    data: {
      id,
      community_id: communityId,
      concept: overrides.concept ?? 'Gasto de prueba',
      category: (overrides.category ?? 'MAINTENANCE') as never,
      amount: overrides.amount ?? '1234.56',
      expense_date: overrides.expenseDate ?? new Date('2026-01-15'),
      supplier: overrides.supplier ?? null,
      invoice_id: overrides.invoiceId ?? null,
      created_by: createdBy,
    },
  })
  return id
}

/** Una factura por la via privilegiada (permite due_date en el pasado y status a mano). */
async function makeInvoiceRow(
  communityId: string,
  overrides: {
    number?: string
    concept?: string | null
    amount?: string
    issueDate?: Date
    dueDate?: Date
    status?: string
    supplier?: string | null
    paidAt?: Date | null
  } = {},
): Promise<string> {
  const id = randomUUID()
  await admin.invoices.create({
    data: {
      id,
      community_id: communityId,
      number: overrides.number ?? `INV-${randomUUID().slice(0, 8)}`,
      concept: overrides.concept === undefined ? 'Factura de prueba' : overrides.concept,
      amount: overrides.amount ?? '100.00',
      issue_date: overrides.issueDate ?? new Date('2026-01-01'),
      due_date: overrides.dueDate ?? new Date('2026-02-01'),
      status: (overrides.status ?? 'PENDING') as never,
      supplier: overrides.supplier ?? null,
      paid_at: overrides.paidAt ?? null,
    },
  })
  return id
}

const GASTO_VALIDO = {
  concept: 'Reparación de la bomba',
  category: 'MAINTENANCE' as const,
  amount: 1250.5,
  expenseDate: '2026-01-15',
  supplier: 'Bombeiros Zaragoza SL',
  notes: 'Cambio de la válvula de retención.',
}

const FACTURA_VALIDA = {
  number: 'INV-2026-001',
  concept: 'Seguro de la comunidad',
  amount: 890.25,
  issueDate: '2026-01-10',
  dueDate: '2026-02-10',
  supplier: 'Mapfre',
}

function crearGasto(token: string, comunidad: string, body: object = GASTO_VALIDO) {
  return request(app())
    .post(`${V1}/communities/${comunidad}/expenses`)
    .set('Authorization', token)
    .send(body)
}

function listarGastos(token: string, comunidad: string, query = '') {
  return request(app())
    .get(`${V1}/communities/${comunidad}/expenses${query}`)
    .set('Authorization', token)
}

function crearFactura(token: string, comunidad: string, body: object = FACTURA_VALIDA) {
  return request(app())
    .post(`${V1}/communities/${comunidad}/invoices`)
    .set('Authorization', token)
    .send(body)
}

function listarFacturas(token: string, comunidad: string, query = '') {
  return request(app())
    .get(`${V1}/communities/${comunidad}/invoices${query}`)
    .set('Authorization', token)
}

function pagarFactura(token: string, comunidad: string, invoiceId: string) {
  return request(app())
    .post(`${V1}/communities/${comunidad}/invoices/${invoiceId}/pay`)
    .set('Authorization', token)
}

function resumen(token: string, comunidad: string) {
  return request(app())
    .get(`${V1}/communities/${comunidad}/finance/summary`)
    .set('Authorization', token)
}

// ---------------------------------------------------------------------------

describe('Seguridad y aislamiento entre comunidades', () => {
  it('sin token, las nueve rutas son 401', async () => {
    const e = await escena()
    const gasto = await makeExpenseRow(e.comunidad, e.admin.id)
    const factura = await makeInvoiceRow(e.comunidad)

    const sinToken = async (nombre: string, peticion: request.Test) => {
      const res = await peticion
      expect(res.status, nombre).toBe(401)
    }

    await sinToken('GET expenses', request(app()).get(`${V1}/communities/${e.comunidad}/expenses`))
    await sinToken(
      'POST expenses',
      request(app()).post(`${V1}/communities/${e.comunidad}/expenses`),
    )
    await sinToken('GET invoices', request(app()).get(`${V1}/communities/${e.comunidad}/invoices`))
    await sinToken(
      'POST invoices',
      request(app()).post(`${V1}/communities/${e.comunidad}/invoices`),
    )
    await sinToken(
      'POST pay',
      request(app()).post(`${V1}/communities/${e.comunidad}/invoices/${factura}/pay`),
    )
    await sinToken(
      'GET summary',
      request(app()).get(`${V1}/communities/${e.comunidad}/finance/summary`),
    )
    await sinToken('GET expense', request(app()).get(`${V1}/expenses/${gasto}`))
    await sinToken('PUT expense', request(app()).put(`${V1}/expenses/${gasto}`))
    await sinToken('DELETE expense', request(app()).delete(`${V1}/expenses/${gasto}`))
  })

  it('un no miembro: 403 en las rutas de comunidad y 404 en el gasto', async () => {
    const e = await escena()
    const ajeno = await outsider()
    const gasto = await makeExpenseRow(e.comunidad, e.admin.id)

    expect((await listarGastos(ajeno.token, e.comunidad)).status).toBe(403)
    expect((await crearGasto(ajeno.token, e.comunidad)).status).toBe(403)
    expect((await listarFacturas(ajeno.token, e.comunidad)).status).toBe(403)
    expect((await crearFactura(ajeno.token, e.comunidad)).status).toBe(403)
    expect((await resumen(ajeno.token, e.comunidad)).status).toBe(403)

    // Por id resuelve con el predicado de la funcion: cero filas -> 404 (C-8).
    const detalle = await request(app())
      .get(`${V1}/expenses/${gasto}`)
      .set('Authorization', ajeno.token)
    expect(detalle.status).toBe(404)
    expect(detalle.body.error.code).toBe('NOT_FOUND')
  })

  it('un miembro de A no ve ni gestiona las finanzas de B', async () => {
    const e = await escena()
    const comunidadB = await nuevaComunidad('Comunidad B')
    await makeMember(e.admin.id, comunidadB, 'ADMIN')
    const gastoB = await makeExpenseRow(comunidadB, e.admin.id)

    expect((await listarGastos(e.vecino.token, comunidadB)).status).toBe(403)

    const detalle = await request(app())
      .get(`${V1}/expenses/${gastoB}`)
      .set('Authorization', e.vecino.token)
    expect(detalle.status).toBe(404)
  })

  it('un ADMIN_SA que no es miembro: 403 en la comunidad y 404 en el gasto', async () => {
    const e = await escena()
    const elena = await adminSa()
    const gasto = await makeExpenseRow(e.comunidad, e.admin.id)

    expect((await resumen(elena.token, e.comunidad)).status).toBe(403)
    expect((await listarGastos(elena.token, e.comunidad)).status).toBe(403)

    const detalle = await request(app())
      .get(`${V1}/expenses/${gasto}`)
      .set('Authorization', elena.token)
    expect(detalle.status).toBe(404)
  })

  it('un miembro suspendido: 403 en el listado y 404 en el gasto', async () => {
    const e = await escena()
    const gasto = await makeExpenseRow(e.comunidad, e.admin.id)

    await admin.communityMembers.update({
      where: { community_id_user_id: { community_id: e.comunidad, user_id: e.vecino.id } },
      data: { status: 'SUSPENDED' },
    })

    expect((await listarGastos(e.vecino.token, e.comunidad)).status).toBe(403)

    const detalle = await request(app())
      .get(`${V1}/expenses/${gasto}`)
      .set('Authorization', e.vecino.token)
    expect(detalle.status).toBe(404)
  })

  it('un id que no es un UUID es 400', async () => {
    const e = await escena()

    for (const ruta of [`${V1}/expenses/no-es-uuid`, `${V1}/expenses/no-es-uuid`]) {
      const res = await request(app()).get(ruta).set('Authorization', e.admin.token)
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    }

    const comunidadMala = await request(app())
      .get(`${V1}/communities/no-es-uuid/expenses`)
      .set('Authorization', e.admin.token)
    expect(comunidadMala.status).toBe(400)

    const pagoMalo = await pagarFactura(e.admin.token, e.comunidad, 'no-es-uuid')
    expect(pagoMalo.status).toBe(400)
  })
})

describe('Solo ADMIN, listar incluido (FN-1)', () => {
  it('PRESIDENT, NEIGHBOR y PROVIDER reciben 403 en las seis rutas de comunidad', async () => {
    const e = await escena()
    const factura = await makeInvoiceRow(e.comunidad)
    const gasto = await makeExpenseRow(e.comunidad, e.admin.id)

    for (const [nombre, actor_] of [
      ['PRESIDENT', e.presidente],
      ['NEIGHBOR', e.vecino],
      ['PROVIDER', e.proveedor],
    ] as const) {
      expect(
        (await listarGastos(actor_.token, e.comunidad)).status,
        `listar gastos ${nombre}`,
      ).toBe(403)
      expect((await crearGasto(actor_.token, e.comunidad)).status, `crear gasto ${nombre}`).toBe(
        403,
      )
      expect(
        (await listarFacturas(actor_.token, e.comunidad)).status,
        `listar facturas ${nombre}`,
      ).toBe(403)
      expect(
        (await crearFactura(actor_.token, e.comunidad)).status,
        `crear factura ${nombre}`,
      ).toBe(403)
      expect(
        (await pagarFactura(actor_.token, e.comunidad, factura)).status,
        `pagar ${nombre}`,
      ).toBe(403)
      expect((await resumen(actor_.token, e.comunidad)).status, `resumen ${nombre}`).toBe(403)

      // El gasto por id tampoco: 404, no 403 (C-8, FN-4).
      const detalle = await request(app())
        .get(`${V1}/expenses/${gasto}`)
        .set('Authorization', actor_.token)
      expect(detalle.status, `detalle ${nombre}`).toBe(404)
    }
  })

  it('el PRESIDENT no edita ni borra: 403 con el mensaje propio de gastos', async () => {
    const e = await escena()
    const gasto = await makeExpenseRow(e.comunidad, e.admin.id)

    const put = await request(app())
      .put(`${V1}/expenses/${gasto}`)
      .set('Authorization', e.presidente.token)
      .send(GASTO_VALIDO)
    expect(put.status).toBe(403)
    expect(put.body.error.message).toBe('Solo un administrador puede gestionar gastos.')

    const del = await request(app())
      .delete(`${V1}/expenses/${gasto}`)
      .set('Authorization', e.presidente.token)
    expect(del.status).toBe(403)
  })
})

describe('Gastos (FN-7, FN-8, FN-9)', () => {
  it('el ADMIN crea con defaults, la respuesta sale de la relectura y hay Location', async () => {
    const e = await escena()

    const res = await crearGasto(e.admin.token, e.comunidad, {
      concept: '  Reparación de la bomba  ',
      amount: 1250.5,
      expenseDate: '2026-01-15',
      supplier: '   ',
      notes: '',
    })

    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const gasto = res.body.data

    expect(res.headers.location).toBe(`/api/v1/expenses/${gasto.id}`)
    expect(gasto.communityId).toBe(e.comunidad)
    expect(gasto.concept).toBe('Reparación de la bomba')
    expect(gasto.category).toBe('OTHER')
    // FN-9: numero, no el string del numeric.
    expect(typeof gasto.amount).toBe('number')
    expect(gasto.amount).toBe(1250.5)
    expect(gasto.expenseDate).toBe('2026-01-15')
    // supplier y notes vacios acaban en null (los btrim/nullif de la funcion).
    expect(gasto.supplier).toBeNull()
    expect(gasto.notes).toBeNull()
    expect(gasto.invoiceId).toBeNull()
    expect(gasto.invoiceNumber).toBeNull()
    expect(gasto.createdBy).toBe(e.admin.id)
    expect(gasto.createdByName).toBe('Administradora')
  })

  it('valida la forma y los limites ANTES de escribir (400 y listado vacio)', async () => {
    const e = await escena()

    const casos: Array<[string, Record<string, unknown>]> = [
      ['concept vacio', { ...GASTO_VALIDO, concept: '' }],
      ['concept de 121', { ...GASTO_VALIDO, concept: 'a'.repeat(121) }],
      ['categoria inventada', { ...GASTO_VALIDO, category: 'LIMPIEZA' }],
      ['importe 0', { ...GASTO_VALIDO, amount: 0 }],
      ['importe de texto', { ...GASTO_VALIDO, amount: '1250.50' }],
      ['fecha mal formada', { ...GASTO_VALIDO, expenseDate: '15/01/2026' }],
      ['fecha inexistente', { ...GASTO_VALIDO, expenseDate: '2026-02-31' }],
      ['invoiceId que no es uuid', { ...GASTO_VALIDO, invoiceId: 'no-es-uuid' }],
      ['createdBy en el cuerpo', { ...GASTO_VALIDO, createdBy: e.admin.id }],
      ['communityId en el cuerpo', { ...GASTO_VALIDO, communityId: e.comunidad }],
      ['status en el cuerpo', { ...GASTO_VALIDO, status: 'PAID' }],
    ]

    for (const [nombre, body] of casos) {
      const res = await crearGasto(e.admin.token, e.comunidad, body)
      expect(res.status, `con ${nombre}: ${JSON.stringify(res.body)}`).toBe(400)
      expect(res.body.error.code, `con ${nombre}`).toBe('VALIDATION_ERROR')
    }

    const lista = await listarGastos(e.admin.token, e.comunidad)
    expect(lista.body.data).toHaveLength(0)
  })

  it('GET /expenses/:id devuelve el gasto y un id inexistente es 404', async () => {
    const e = await escena()
    const creado = (await crearGasto(e.admin.token, e.comunidad)).body.data

    const res = await request(app())
      .get(`${V1}/expenses/${creado.id}`)
      .set('Authorization', e.admin.token)
    expect(res.status).toBe(200)
    expect(res.body.data.id).toBe(creado.id)
    expect(res.body.data.concept).toBe('Reparación de la bomba')

    const ausente = await request(app())
      .get(`${V1}/expenses/${randomUUID()}`)
      .set('Authorization', e.admin.token)
    expect(ausente.status).toBe(404)
  })

  it('el PUT reemplaza por completo: limpiar el proveedor es mandarlo nulo o vacio', async () => {
    const e = await escena()
    const creado = (
      await crearGasto(e.admin.token, e.comunidad, {
        ...GASTO_VALIDO,
        supplier: 'Proveedor original',
        notes: 'Nota',
      })
    ).body.data

    const res = await request(app())
      .put(`${V1}/expenses/${creado.id}`)
      .set('Authorization', e.admin.token)
      .send({
        concept: 'Pintura del portal',
        category: 'MAINTENANCE',
        amount: 300,
        expenseDate: '2026-03-01',
        supplier: null,
        invoiceId: null,
        notes: '',
      })

    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.data.concept).toBe('Pintura del portal')
    expect(res.body.data.amount).toBe(300)
    expect(res.body.data.supplier).toBeNull()
    expect(res.body.data.notes).toBeNull()
    // El createdAt del alta no cambia; el PUT es reemplazo de contenido, no de fila.
    expect(res.body.data.id).toBe(creado.id)
  })

  it('el PUT de un id inexistente es 404 y el de un no-ADMIN es 403', async () => {
    const e = await escena()

    const ausente = await request(app())
      .put(`${V1}/expenses/${randomUUID()}`)
      .set('Authorization', e.admin.token)
      .send(GASTO_VALIDO)
    expect(ausente.status).toBe(404)

    const gasto = await makeExpenseRow(e.comunidad, e.admin.id)
    const porVecino = await request(app())
      .put(`${V1}/expenses/${gasto}`)
      .set('Authorization', e.vecino.token)
      .send(GASTO_VALIDO)
    expect(porVecino.status).toBe(403)
  })

  it('el DELETE es soft: 200, deja de verse y el segundo es 404', async () => {
    const e = await escena()
    const creado = (await crearGasto(e.admin.token, e.comunidad)).body.data

    const borrado = await request(app())
      .delete(`${V1}/expenses/${creado.id}`)
      .set('Authorization', e.admin.token)
    expect(borrado.status).toBe(200)
    expect(borrado.body.data).toEqual({ id: creado.id, deleted: true })

    // La fila sigue viva (soft delete), pero ya no se sirve por la API.
    const fila = await admin.expenses.findUnique({
      where: { id: creado.id },
      select: { deleted_at: true },
    })
    expect(fila?.deleted_at).not.toBeNull()

    const detalle = await request(app())
      .get(`${V1}/expenses/${creado.id}`)
      .set('Authorization', e.admin.token)
    expect(detalle.status).toBe(404)

    const lista = await listarGastos(e.admin.token, e.comunidad)
    expect(lista.body.data).toHaveLength(0)

    const otraVez = await request(app())
      .delete(`${V1}/expenses/${creado.id}`)
      .set('Authorization', e.admin.token)
    expect(otraVez.status).toBe(404)
    expect(otraVez.body.error.code).toBe('NOT_FOUND')
  })
})

describe('Facturas (FN-5, FN-6, FN-12, FN-14)', () => {
  it('el ADMIN crea: 201 SIN Location, concept vacio a null y effectiveStatus derivado', async () => {
    const e = await escena()

    const res = await crearFactura(e.admin.token, e.comunidad, {
      number: '  INV-2026-007  ',
      concept: '',
      amount: 480,
      issueDate: '2026-10-01',
      dueDate: '2026-12-31',
      supplier: 'Limpiosol',
    })

    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.headers.location).toBeUndefined()

    const factura = res.body.data
    expect(factura.number).toBe('INV-2026-007')
    expect(factura.concept).toBeNull()
    expect(factura.amount).toBe(480)
    expect(factura.status).toBe('PENDING')
    expect(factura.effectiveStatus).toBe('PENDING')
    expect(factura.paidAt).toBeNull()
    expect(factura.isGenerated).toBe(false)
    expect(factura.createdByName).toBe('Administradora')
  })

  it('el numero repetido en la comunidad es un 409 INVOICE_NUMBER_TAKEN (FN-12)', async () => {
    const e = await escena()
    await crearFactura(e.admin.token, e.comunidad, { ...FACTURA_VALIDA, number: 'INV-DUP' })

    const repetida = await crearFactura(e.admin.token, e.comunidad, {
      ...FACTURA_VALIDA,
      number: 'INV-DUP',
    })
    expect(repetida.status).toBe(409)
    expect(repetida.body.error.code).toBe('INVOICE_NUMBER_TAKEN')
  })

  it('el mismo numero en OTRA comunidad no es conflicto', async () => {
    const e = await escena()
    const comunidadB = await nuevaComunidad('Comunidad B')
    await makeMember(e.admin.id, comunidadB, 'ADMIN')

    await crearFactura(e.admin.token, e.comunidad, { ...FACTURA_VALIDA, number: 'INV-SHARED' })
    const enB = await crearFactura(e.admin.token, comunidadB, {
      ...FACTURA_VALIDA,
      number: 'INV-SHARED',
    })
    expect(enB.status).toBe(201)
  })

  it('rechaza dueDate anterior a issueDate con 400', async () => {
    const e = await escena()

    const res = await crearFactura(e.admin.token, e.comunidad, {
      ...FACTURA_VALIDA,
      issueDate: '2026-03-10',
      dueDate: '2026-03-09',
    })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('?status=OVERDUE filtra por el estado efectivo, no por la columna (FN-14)', async () => {
    const e = await escena()
    const vencida = await makeInvoiceRow(e.comunidad, {
      number: 'INV-VENCIDA',
      issueDate: new Date('2019-01-01'),
      dueDate: new Date('2020-01-01'),
      status: 'PENDING',
    })
    const pendiente = await makeInvoiceRow(e.comunidad, {
      number: 'INV-FUTURA',
      issueDate: new Date('2026-01-01'),
      dueDate: new Date('2999-01-01'),
      status: 'PENDING',
    })

    const soloVencidas = await listarFacturas(e.admin.token, e.comunidad, '?status=OVERDUE')
    expect(soloVencidas.status).toBe(200)
    expect(soloVencidas.body.data.map((f: { id: string }) => f.id)).toEqual([vencida])
    // La columna sigue siendo PENDING: OVERDUE es derivado.
    expect(soloVencidas.body.data[0].status).toBe('PENDING')
    expect(soloVencidas.body.data[0].effectiveStatus).toBe('OVERDUE')

    const soloPendientes = await listarFacturas(e.admin.token, e.comunidad, '?status=PENDING')
    expect(soloPendientes.body.data.map((f: { id: string }) => f.id)).toEqual([pendiente])
  })

  it('pagar: 200 con status PAID y paidAt; el segundo pago es 409 INVOICE_ALREADY_PAID (FN-6)', async () => {
    const e = await escena()
    const factura = (
      await crearFactura(e.admin.token, e.comunidad, { ...FACTURA_VALIDA, number: 'INV-PAGO' })
    ).body.data

    const pago = await pagarFactura(e.admin.token, e.comunidad, factura.id)
    expect(pago.status, JSON.stringify(pago.body)).toBe(200)
    expect(pago.body.data.status).toBe('PAID')
    expect(pago.body.data.effectiveStatus).toBe('PAID')
    expect(pago.body.data.paidAt).not.toBeNull()

    const segundo = await pagarFactura(e.admin.token, e.comunidad, factura.id)
    expect(segundo.status).toBe(409)
    expect(segundo.body.error.code).toBe('INVOICE_ALREADY_PAID')
  })

  it('pagar una factura inexistente es 404', async () => {
    const e = await escena()

    const res = await pagarFactura(e.admin.token, e.comunidad, randomUUID())
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })
})

describe('Vinculo gasto-factura (FN-10)', () => {
  it('un gasto puede apuntar a una factura de su comunidad y la vista trae el numero', async () => {
    const e = await escena()
    const factura = (
      await crearFactura(e.admin.token, e.comunidad, { ...FACTURA_VALIDA, number: 'INV-VINC' })
    ).body.data

    const res = await crearGasto(e.admin.token, e.comunidad, {
      ...GASTO_VALIDO,
      invoiceId: factura.id,
    })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body.data.invoiceId).toBe(factura.id)
    expect(res.body.data.invoiceNumber).toBe('INV-VINC')
  })

  it('la factura de OTRA comunidad es un 400 EXPENSE_INVOICE_MISMATCH', async () => {
    const e = await escena()
    const comunidadB = await nuevaComunidad('Comunidad B')
    const facturaB = await makeInvoiceRow(comunidadB, { number: 'INV-B' })

    const res = await crearGasto(e.admin.token, e.comunidad, {
      ...GASTO_VALIDO,
      invoiceId: facturaB,
    })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('EXPENSE_INVOICE_MISMATCH')
  })
})

describe('Resumen (spec 09 §5.10)', () => {
  it('resume gastos por categoria y el estado de las facturas, con el vencido aparte', async () => {
    const e = await escena()

    await makeExpenseRow(e.comunidad, e.admin.id, {
      concept: 'A',
      category: 'CLEANING',
      amount: '100.00',
      expenseDate: new Date('2026-01-10'),
    })
    await makeExpenseRow(e.comunidad, e.admin.id, {
      concept: 'B',
      category: 'CLEANING',
      amount: '50.00',
      expenseDate: new Date('2026-01-11'),
    })
    await makeExpenseRow(e.comunidad, e.admin.id, {
      concept: 'C',
      category: 'INSURANCE',
      amount: '200.00',
      expenseDate: new Date('2026-01-12'),
    })

    await makeInvoiceRow(e.comunidad, {
      number: 'INV-P',
      amount: '300.00',
      status: 'PAID',
      paidAt: new Date('2026-01-20'),
    })
    await makeInvoiceRow(e.comunidad, {
      number: 'INV-PEND',
      amount: '80.00',
      status: 'PENDING',
      issueDate: new Date('2026-01-01'),
      dueDate: new Date('2999-01-01'),
    })
    await makeInvoiceRow(e.comunidad, {
      number: 'INV-OVER',
      amount: '20.00',
      status: 'PENDING',
      issueDate: new Date('2019-01-01'),
      dueDate: new Date('2020-01-01'),
    })

    const res = await resumen(e.admin.token, e.comunidad)
    expect(res.status, JSON.stringify(res.body)).toBe(200)

    const s = res.body.data
    expect(s.expenseTotal).toBe(350)
    expect(s.expenseCount).toBe(3)

    const limpieza = s.expenseByCategory.find(
      (c: { category: string }) => c.category === 'CLEANING',
    )
    expect(limpieza.total).toBe(150)
    expect(limpieza.count).toBe(2)

    expect(s.invoiceTotal).toBe(400)
    expect(s.invoiceCount).toBe(3)
    expect(s.invoicePaidAmount).toBe(300)
    expect(s.invoiceOpenAmount).toBe(100)
    expect(s.invoicePendingCount).toBe(1)
    expect(s.invoiceOverdueCount).toBe(1)

    // Los recientes van por fecha descendente y como maximo cinco.
    expect(Array.isArray(s.expenseRecent)).toBe(true)
    expect(s.expenseRecent[0].concept).toBe('C')
    expect(Object.keys(s.expenseRecent[0]).sort()).toEqual(
      ['amount', 'category', 'concept', 'expenseDate', 'id', 'supplier'].sort(),
    )
  })

  it('una comunidad vacia devuelve la fila con ceros (D-2)', async () => {
    const e = await escena()

    const res = await resumen(e.admin.token, e.comunidad)
    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      expenseTotal: 0,
      expenseCount: 0,
      expenseByCategory: [],
      expenseRecent: [],
      invoiceTotal: 0,
      invoiceCount: 0,
      invoiceOpenAmount: 0,
      invoicePaidAmount: 0,
      invoicePendingCount: 0,
      invoiceOverdueCount: 0,
    })
  })
})

describe('Listado y filtros (§7.3)', () => {
  it('ordena por fecha descendente y paginacion con meta', async () => {
    const e = await escena()
    await makeExpenseRow(e.comunidad, e.admin.id, {
      concept: 'Viejo',
      expenseDate: new Date('2026-01-01'),
    })
    await makeExpenseRow(e.comunidad, e.admin.id, {
      concept: 'Medio',
      expenseDate: new Date('2026-02-01'),
    })
    await makeExpenseRow(e.comunidad, e.admin.id, {
      concept: 'Nuevo',
      expenseDate: new Date('2026-03-01'),
    })

    const pagina1 = await listarGastos(e.admin.token, e.comunidad, '?page=1&limit=2')
    expect(pagina1.body.data.map((g: { concept: string }) => g.concept)).toEqual(['Nuevo', 'Medio'])
    expect(pagina1.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 })

    const pagina2 = await listarGastos(e.admin.token, e.comunidad, '?page=2&limit=2')
    expect(pagina2.body.data.map((g: { concept: string }) => g.concept)).toEqual(['Viejo'])
    expect(pagina2.body.meta).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 })

    const masAlla = await listarGastos(e.admin.token, e.comunidad, '?page=5&limit=2')
    expect(masAlla.body.data).toHaveLength(0)
    expect(masAlla.body.meta).toEqual({ page: 5, limit: 2, total: 3, totalPages: 2 })
  })

  it('filtra por categoria y por rango de fechas', async () => {
    const e = await escena()
    const limpieza = await makeExpenseRow(e.comunidad, e.admin.id, {
      category: 'CLEANING',
      expenseDate: new Date('2026-01-15'),
    })
    await makeExpenseRow(e.comunidad, e.admin.id, {
      category: 'INSURANCE',
      expenseDate: new Date('2026-06-15'),
    })

    const porCategoria = await listarGastos(e.admin.token, e.comunidad, '?category=CLEANING')
    expect(porCategoria.body.data.map((g: { id: string }) => g.id)).toEqual([limpieza])

    const porRango = await listarGastos(
      e.admin.token,
      e.comunidad,
      '?from=2026-01-01&to=2026-02-01',
    )
    expect(porRango.body.data.map((g: { id: string }) => g.id)).toEqual([limpieza])

    const fueraDeRango = await listarGastos(
      e.admin.token,
      e.comunidad,
      '?from=2027-01-01&to=2027-12-31',
    )
    expect(fueraDeRango.body.data).toHaveLength(0)
  })

  it('los query params invalidos son 400', async () => {
    const e = await escena()

    const casos: Array<[string, string]> = [
      ['category fuera de enum', '?category=LIMPIEZA'],
      ['page 0', '?page=0'],
      ['limit 101', '?limit=101'],
      ['from posterior a to', '?from=2026-12-31&to=2026-01-01'],
      ['parametro desconocido', '?q=ascensor'],
    ]

    for (const [nombre, query] of casos) {
      const res = await listarGastos(e.admin.token, e.comunidad, query)
      expect(res.status, `con ${nombre}`).toBe(400)
      expect(res.body.error.code, `con ${nombre}`).toBe('VALIDATION_ERROR')
    }

    const estadoMalo = await listarFacturas(e.admin.token, e.comunidad, '?status=PAGADA')
    expect(estadoMalo.status).toBe(400)
  })

  it('el sobre es { data, meta } en exito y { error } en fallo', async () => {
    const e = await escena()

    const ok_ = await listarGastos(e.admin.token, e.comunidad)
    expect(ok_.body).toHaveProperty('data')
    expect(ok_.body).toHaveProperty('meta')
    expect(ok_.body).not.toHaveProperty('error')

    const fallo = await crearGasto(e.vecino.token, e.comunidad, {})
    expect(fallo.body).toHaveProperty('error')
    expect(fallo.body.error).toMatchObject({ code: 'FORBIDDEN' })
    expect(typeof fallo.body.error.message).toBe('string')
  })
})
