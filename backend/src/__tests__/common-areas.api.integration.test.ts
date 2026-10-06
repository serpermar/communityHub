// ---------------------------------------------------------------------------
// Zonas comunes por API: seguridad, visibilidad, alta, reconfiguracion y
// disponibilidad.
//
// Este archivo es el que demuestra que el bloque 05 hace lo que dice. Los
// unitarios comprueban la FORMA de lo que entra; aqui lo que se comprueba es
// QUIEN puede ver y QUE puede hacer, y eso no se puede decidir sin la base de
// datos.
//
// La regla de `helpers.ts` ("sembrar con privilegio, afirmar con restriccion")
// se cumple sin excepcion: los fixtures se crean con `admin` y todas las
// afirmaciones pasan por la API, es decir, por el rol de runtime con RLS.
//
// Los casos que estan aqui y no en los unitarios, y por que:
//
//   - El aislamiento entre comunidades. Una zona de A puesta en la URL de
//     alguien de B tiene que dar 404, y ninguna regla de zod lo detecta.
//   - La terna de rol del alta: el guard HTTP (ADMIN) y la funcion SQL
//     (ADMIN dentro de la transaccion) tienen que dar el MISMO 403. Si uno de
//     los dos no esta, el 409/403/404 sale de un solo sitio y el otro endpoint
//     queda abierto.
//   - El nombre duplicado como 409 y no como 400. El indice unico es quien lo
//     decide, y solo se puede provocar contra Postgres.
//   - La disponibilidad: la rejilla, la ocupacion por `area_slots` y el
//     "la zona dada de baja devuelve su rejilla" son calculos de SQL que no
//     existen en TypeScript.
//
// NOTA sobre los 404 de las rutas de zona: `PUT /common-areas/:id` y `GET
// .../availability` no llevan comunidad en la URL, y `requireCommonArea()`
// resuelve la comunidad de la ZONA. Un id inexistente, el de otra comunidad o
// el de una comunidad a la que ya no perteneces son el mismo 404, y por el
// mismo motivo (C-8): un 403 confirmaria que ese id existe.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import {
  app,
  createUser,
  deleteCommunity,
  deleteUser,
  makeCommunity,
  makeMember,
  type TestUser,
} from './helpers.js'

const COM = '/api/v1/communities'

const usuarios: string[] = []
const comunidades: string[] = []

afterEach(async () => {
  while (comunidades.length > 0) {
    await deleteCommunity(comunidades.pop()!).catch(() => undefined)
  }
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
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: user.password })
  expect(res.status).toBe(200)
  return `Bearer ${res.body.data.accessToken}`
}

type Actor = TestUser & { token: string }

async function actorEn(
  user: TestUser,
  communityId: string,
  role: 'ADMIN' | 'PRESIDENT' | 'NEIGHBOR' | 'PROVIDER',
): Promise<Actor> {
  await makeMember(user.id, communityId, role)
  return { ...user, token: await tokenDe(user) }
}

/**
 * La comunidad con los cinco roles de este bloque.
 *
 * Se construye entera en una funcion porque casi todos los tests necesitan un
 * ADMIN (que es quien gestiona) y un vecino (que es quien lee). Anadir los
 * demas roles aqui, y no en cada test, evita que cada caso repita cinco
 * `makeMember`.
 */
async function escena(): Promise<{
  comunidad: string
  admin: Actor
  presidente: Actor
  vecino: Actor
  vecinoB: Actor
  proveedor: Actor
}> {
  const comunidad = await nuevaComunidad()

  return {
    comunidad,
    admin: await actorEn(await nuevoUsuario({ fullName: 'Administradora' }), comunidad, 'ADMIN'),
    presidente: await actorEn(await nuevoUsuario({ fullName: 'Presidente' }), comunidad, 'PRESIDENT'),
    vecino: await actorEn(await nuevoUsuario({ fullName: 'Vecina' }), comunidad, 'NEIGHBOR'),
    vecinoB: await actorEn(await nuevoUsuario({ fullName: 'Vecino' }), comunidad, 'NEIGHBOR'),
    proveedor: await actorEn(await nuevoUsuario({ fullName: 'Proveedor' }), comunidad, 'PROVIDER'),
  }
}

/** El cuerpo minimo de un POST valido, con nombre unico por test. */
function altaValida(extra: Record<string, unknown> = {}) {
  return { name: `Zona ${randomUUID().slice(0, 8)}`, ...extra }
}

/** El PUT completo que exige CA-4. */
function putValido(nombre: string, extra: Record<string, unknown> = {}) {
  return {
    name: nombre,
    type: 'SWIMMING_POOL',
    description: 'Descripcion de la zona.',
    capacity: 20,
    slotMinutes: 60,
    openTime: '08:00',
    closeTime: '22:00',
    maxDailyReservations: 10,
    requiresApproval: false,
    isActive: true,
    ...extra,
  }
}

/** Crea una zona por la API y devuelve el cuerpo de la respuesta. */
async function crear(token: string, comunidad: string, extra: Record<string, unknown> = {}) {
  const res = await request(app())
    .post(`${COM}/${comunidad}/common-areas`)
    .set('Authorization', token)
    .send(altaValida(extra))
  expect(res.status, `creando: ${JSON.stringify(res.body)}`).toBe(201)
  return res.body.data
}

/** Crea una zona dada de baja por el lado privilegiado, para la spec 06. */
async function crearZonaBaja(communityId: string): Promise<string> {
  const { admin } = await import('../db-admin.js')
  const id = randomUUID()
  await admin.commonAreas.create({
    data: {
      id,
      community_id: communityId,
      name: `Zona baja ${id.slice(0, 8)}`,
      type: 'OTHER',
      is_active: false,
    },
  })
  return id
}

// ---------------------------------------------------------------------------

describe('Seguridad y aislamiento entre comunidades', () => {
  it('sin token, las cuatro rutas son 401', async () => {
    const e = await escena()
    const zona = await crear(e.admin.token, e.comunidad)

    const lista = await request(app()).get(`${COM}/${e.comunidad}/common-areas`)
    expect(lista.status).toBe(401)

    const alta = await request(app()).post(`${COM}/${e.comunidad}/common-areas`).send(altaValida())
    expect(alta.status).toBe(401)

    const detalle = await request(app()).get(`/api/v1/common-areas/${zona.id}/availability?date=2026-10-10`)
    expect(detalle.status).toBe(401)

    const put = await request(app()).put(`/api/v1/common-areas/${zona.id}`).send(putValido('Otra'))
    expect(put.status).toBe(401)
  })

  it('un no miembro recibe 403 en el listado y 404 en las rutas de zona', async () => {
    const e = await escena()
    const outsider = await nuevoUsuario({ fullName: 'De fuera' })
    const outsiderToken = await tokenDe(outsider)
    const zona = await crear(e.admin.token, e.comunidad)

    // El listado es 403: la comunidad existe y este usuario no es miembro, y
    // eso se puede decir sin filtrar nada.
    const lista = await request(app()).get(`${COM}/${e.comunidad}/common-areas`).set('Authorization', outsiderToken)
    expect(lista.status).toBe(403)

    // Las dos de zona son 404: la zona no es visible para el, y un 403
    // confirmaria que ese id existe (C-8).
    const put = await request(app())
      .put(`/api/v1/common-areas/${zona.id}`)
      .set('Authorization', outsiderToken)
      .send(putValido('Intento'))
    expect(put.status).toBe(404)

    const disp = await request(app())
      .get(`/api/v1/common-areas/${zona.id}/availability?date=2026-10-10`)
      .set('Authorization', outsiderToken)
    expect(disp.status).toBe(404)
  })

  it('un ADMIN de otra comunidad tampoco puede escribir en la zona ajena', async () => {
    const e = await escena()
    const otra = await nuevaComunidad('Comunidad ajena')
    const adminDeOtra = await actorEn(await nuevoUsuario({ fullName: 'Admin ajeno' }), otra, 'ADMIN')
    const zona = await crear(e.admin.token, e.comunidad)

    const put = await request(app())
      .put(`/api/v1/common-areas/${zona.id}`)
      .set('Authorization', adminDeOtra.token)
      .send(putValido('Ocupada'))

    // 404 y no 403: desde fuera de la comunidad ni siquiera se sabe que la zona
    // existe.
    expect(put.status).toBe(404)
  })

  it('un id de zona que no es un UUID es 400, sin llegar a la base de datos', async () => {
    const e = await escena()

    const put = await request(app())
      .put('/api/v1/common-areas/no-es-uuid')
      .set('Authorization', e.admin.token)
      .send(putValido('Intento'))
    expect(put.status).toBe(400)
    expect(put.body.error.code).toBe('VALIDATION_ERROR')

    const disp = await request(app())
      .get('/api/v1/common-areas/tampoco-es-uuid/availability?date=2026-10-10')
      .set('Authorization', e.admin.token)
    expect(disp.status).toBe(400)
  })

  it('un communityId que no es un UUID es 400', async () => {
    const e = await escena()

    const lista = await request(app()).get(`${COM}/no-es-uuid/common-areas`).set('Authorization', e.admin.token)
    expect(lista.status).toBe(400)
  })
})

describe('Lectura (CA-1)', () => {
  it('cualquier rol activo lee el listado, sin distinguir rol', async () => {
    const e = await escena()
    await crear(e.admin.token, e.comunidad, { name: 'Piscina comun' })
    await crear(e.admin.token, e.comunidad, { name: 'Gimnasio com' })

    for (const [nombre, actor] of [
      ['ADMIN', e.admin],
      ['PRESIDENT', e.presidente],
      ['NEIGHBOR', e.vecino],
      ['PROVIDER', e.proveedor],
    ] as const) {
      const res = await request(app()).get(`${COM}/${e.comunidad}/common-areas`).set('Authorization', actor.token)

      expect(res.status, `con rol ${nombre}`).toBe(200)
      expect(res.body.data, `con rol ${nombre}`).toHaveLength(2)
    }
  })

  it('las zonas dadas de baja salen en la lista (CA-3)', async () => {
    const e = await escena()
    const baja = await crearZonaBaja(e.comunidad)

    const res = await request(app()).get(`${COM}/${e.comunidad}/common-areas`).set('Authorization', e.vecino.token)

    expect(res.status).toBe(200)
    const ids = res.body.data.map((z: { id: string }) => z.id)
    expect(ids).toContain(baja)

    const fila = res.body.data.find((z: { id: string }) => z.id === baja)
    expect(fila.isActive).toBe(false)
  })

  it('un miembro suspendido pierde el listado', async () => {
    const e = await escena()
    await crear(e.admin.token, e.comunidad)

    const { admin } = await import('../db-admin.js')
    await admin.communityMembers.update({
      where: { community_id_user_id: { community_id: e.comunidad, user_id: e.vecino.id } },
      data: { status: 'SUSPENDED' },
    })

    const res = await request(app()).get(`${COM}/${e.comunidad}/common-areas`).set('Authorization', e.vecino.token)
    expect(res.status).toBe(403)
  })
})

describe('Alta (CA-1, CA-2, CA-6)', () => {
  it('un ADMIN crea una zona con los defaults de la columna', async () => {
    const e = await escena()
    const zona = await crear(e.admin.token, e.comunidad)

    expect(zona.name).toMatch(/^Zona /)
    expect(zona.type).toBe('OTHER')
    expect(zona.slotMinutes).toBe(60)
    expect(zona.openTime).toBe('08:00')
    expect(zona.closeTime).toBe('22:00')
    expect(zona.requiresApproval).toBe(false)
    expect(zona.isActive).toBe(true)
    expect(zona.capacity).toBeNull()
    expect(zona.communityId).toBe(e.comunidad)
    // Sin Location: la API no expone GET /common-areas/:id como endpoint.
  })

  it('un NEIGHBOR, un PRESIDENT o un PROVIDER reciben 403', async () => {
    const e = await escena()

    for (const [nombre, actor] of [
      ['NEIGHBOR', e.vecino],
      ['PRESIDENT', e.presidente],
      ['PROVIDER', e.proveedor],
    ] as const) {
      const res = await request(app())
        .post(`${COM}/${e.comunidad}/common-areas`)
        .set('Authorization', actor.token)
        .send(altaValida())

      expect(res.status, `con rol ${nombre}`).toBe(403)
      expect(res.body.error.code, `con rol ${nombre}`).toBe('FORBIDDEN')
    }
  })

  it('un nombre repetido en la misma comunidad es 409, no 400', async () => {
    const e = await escena()
    const nombre = `Piscina ${randomUUID().slice(0, 8)}`
    await crear(e.admin.token, e.comunidad, { name: nombre })

    const segunda = await request(app())
      .post(`${COM}/${e.comunidad}/common-areas`)
      .set('Authorization', e.admin.token)
      .send(altaValida({ name: nombre }))

    // 409 y no 400: el dato del formulario es valido, lo que pasa es que ya lo
    // usa otro. La accion no es "corregir el campo" sino elegir otro nombre.
    expect(segunda.status).toBe(409)
    expect(segunda.body.error.code).toBe('CONFLICT')
  })

  it('el mismo nombre en otra comunidad no choca', async () => {
    const e = await escena()
    const otra = await nuevaComunidad('Comunidad ajena')
    const adminDeOtra = await actorEn(await nuevoUsuario({ fullName: 'Admin ajeno' }), otra, 'ADMIN')

    const nombre = `Salon ${randomUUID().slice(0, 8)}`
    await crear(e.admin.token, e.comunidad, { name: nombre })
    const enOtra = await crear(adminDeOtra.token, otra, { name: nombre })

    expect(enOtra.name).toBe(nombre)
  })

  it('valida la forma antes de llegar a la base de datos', async () => {
    const e = await escena()

    const casos: Array<[string, Record<string, unknown>]> = [
      ['nombre de un caracter', { name: 'x' }],
      ['slotMinutes fuera del CHECK', { slotMinutes: 45 }],
      ['type inventado', { type: 'PISCINA' }],
      ['horario invertido', { openTime: '22:00', closeTime: '08:00' }],
      ['communityId en el cuerpo', { communityId: e.comunidad }],
      ['descripcion de 501', { description: 'a'.repeat(501) }],
      ['capacidad 0', { capacity: 0 }],
      ['cuerpo vacio', {}],
    ]

    for (const [nombre, cuerpo] of casos) {
      const res = await request(app())
        .post(`${COM}/${e.comunidad}/common-areas`)
        .set('Authorization', e.admin.token)
        .send(cuerpo)

      expect(res.status, `con ${nombre}`).toBe(400)
      expect(res.body.error.code, `con ${nombre}`).toBe('VALIDATION_ERROR')
    }
  })

  it('un nombre con texto de sentinel es un nombre normal, no un error', async () => {
    const e = await escena()

    // Un nombre que contiene el texto exacto de dos sentinels. Es un nombre
    // VALIDO, asi que lo correcto es un 201.
    const zona = await crear(e.admin.token, e.comunidad, { name: 'area_not_found forbidden_role' })

    expect(zona.name).toBe('area_not_found forbidden_role')
  })
})

describe('Reconfiguracion (CA-4, CA-6)', () => {
  it('un ADMIN reconfigura con PUT completo y la respuesta refleja lo escrito', async () => {
    const e = await escena()
    const zona = await crear(e.admin.token, e.comunidad)

    const res = await request(app())
      .put(`/api/v1/common-areas/${zona.id}`)
      .set('Authorization', e.admin.token)
      .send(putValido('Piscina reformada', { requiresApproval: true, slotMinutes: 90, capacity: 40 }))

    expect(res.status).toBe(200)
    expect(res.body.data.name).toBe('Piscina reformada')
    expect(res.body.data.requiresApproval).toBe(true)
    expect(res.body.data.slotMinutes).toBe(90)
    expect(res.body.data.capacity).toBe(40)
  })

  it('un NEIGHBOR o un PRESIDENT reciben 403 de la FUNCION, no del guard', async () => {
    const e = await escena()
    const zona = await crear(e.admin.token, e.comunidad)

    // La ruta de PUT no lleva requireCommunityRole: el rol lo decide
    // app_update_common_area() con la fila delante. Este test es la prueba de
    // que esa capa existe — si desapareciera, estos dos darian 200.
    for (const [nombre, actor] of [
      ['NEIGHBOR', e.vecino],
      ['PRESIDENT', e.presidente],
      ['PROVIDER', e.proveedor],
    ] as const) {
      const res = await request(app())
        .put(`/api/v1/common-areas/${zona.id}`)
        .set('Authorization', actor.token)
        .send(putValido('Intento ajeno'))

      expect(res.status, `con rol ${nombre}`).toBe(403)
      expect(res.body.error.code, `con rol ${nombre}`).toBe('FORBIDDEN')
    }

    // Y la zona sigue como estaba, no como el intento.
    const lista = await request(app()).get(`${COM}/${e.comunidad}/common-areas`).set('Authorization', e.admin.token)
    expect(lista.body.data[0].name).not.toBe('Intento ajeno')
  })

  it('el PUT exige los diez campos', async () => {
    const e = await escena()
    const zona = await crear(e.admin.token, e.comunidad)

    const { capacity: _sinCapacidad, ...incompleto } = putValido('Nombre')

    const res = await request(app())
      .put(`/api/v1/common-areas/${zona.id}`)
      .set('Authorization', e.admin.token)
      .send(incompleto)

    // CA-4: reemplazo completo. Un PUT parcial dejaria campos sin tocar y el
    // cliente tendria que saber de antemano el estado anterior.
    expect(res.status).toBe(400)
  })

  it('un PUT que choca contra el nombre de otra zona es 409', async () => {
    const e = await escena()
    const una = await crear(e.admin.token, e.comunidad, { name: `Gym ${randomUUID().slice(0, 8)}` })
    const otra = await crear(e.admin.token, e.comunidad)

    const res = await request(app())
      .put(`/api/v1/common-areas/${otra.id}`)
      .set('Authorization', e.admin.token)
      .send(putValido(una.name))

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
  })

  it('el PUT puede vaciar los limites a null (CA-10)', async () => {
    const e = await escena()
    const zona = await crear(e.admin.token, e.comunidad, { capacity: 10, maxDailyReservations: 5 })

    const res = await request(app())
      .put(`/api/v1/common-areas/${zona.id}`)
      .set('Authorization', e.admin.token)
      .send(putValido(zona.name, { capacity: null, maxDailyReservations: null, description: null }))

    expect(res.status).toBe(200)
    expect(res.body.data.capacity).toBeNull()
    expect(res.body.data.maxDailyReservations).toBeNull()
    expect(res.body.data.description).toBeNull()
  })
})

describe('Disponibilidad (CA-7, D-2)', () => {
  it('devuelve la rejilla completa del dia con la que el cliente dibuja', async () => {
    const e = await escena()
    const zona = await crear(e.admin.token, e.comunidad, { slotMinutes: 60 })

    const res = await request(app())
      .get(`/api/v1/common-areas/${zona.id}/availability?date=2026-10-10`)
      .set('Authorization', e.vecino.token)

    expect(res.status).toBe(200)
    expect(res.body.data.date).toBe('2026-10-10')
    expect(res.body.data.slotMinutes).toBe(60)
    expect(res.body.data.openTime).toBe('08:00')
    expect(res.body.data.closeTime).toBe('22:00')
    // 08:00 a 22:00 con pasos de 60: catorce huecos, todos libres de serie.
    expect(res.body.data.slots).toHaveLength(14)
    expect(res.body.data.slots.every((s: { status: string }) => s.status === 'FREE')).toBe(true)
  })

  it('marca OCCUPIED el slot que cubre una reserva confirmada', async () => {
    const e = await escena()
    const zona = await crear(e.admin.token, e.comunidad, { slotMinutes: 60 })

    // La ocupacion la siembra `admin` con sus area_slots: es la misma verdad
    // que usa la funcion, y un mock no existiria aqui.
    const { admin } = await import('../db-admin.js')
    const { randomUUID: uuid } = await import('node:crypto')
    const reservaId = uuid()
    const inicio = new Date('2026-10-10T10:00:00.000Z')
    const fin = new Date('2026-10-10T11:00:00.000Z')

    await admin.reservations.create({
      data: {
        id: reservaId,
        community_id: e.comunidad,
        common_area_id: zona.id,
        user_id: e.vecino.id,
        starts_at: inicio,
        ends_at: fin,
        status: 'CONFIRMED',
      },
    })
    await admin.areaSlots.create({
      data: {
        common_area_id: zona.id,
        reservation_id: reservaId,
        starts_at: inicio,
        ends_at: fin,
      },
    })

    const res = await request(app())
      .get(`/api/v1/common-areas/${zona.id}/availability?date=2026-10-10`)
      .set('Authorization', e.vecino.token)

    expect(res.status).toBe(200)

    const ocupados = res.body.data.slots.filter((s: { status: string }) => s.status === 'OCCUPIED')
    expect(ocupados).toHaveLength(1)
    expect(ocupados[0].startsAt).toBe(inicio.toISOString())
    expect(res.body.data.slots.filter((s: { status: string }) => s.status === 'FREE')).toHaveLength(13)
  })

  it('la fecha es obligatoria y con formato estricto', async () => {
    const e = await escena()
    const zona = await crear(e.admin.token, e.comunidad)

    const sinFecha = await request(app())
      .get(`/api/v1/common-areas/${zona.id}/availability`)
      .set('Authorization', e.vecino.token)
    expect(sinFecha.status).toBe(400)

    for (const date of ['2026-2-5', '2026-02-31', 'ayer']) {
      const res = await request(app())
        .get(`/api/v1/common-areas/${zona.id}/availability?date=${encodeURIComponent(date)}`)
        .set('Authorization', e.vecino.token)
      expect(res.status, `con date ${date}`).toBe(400)
    }
  })

  it('la zona dada de baja devuelve su rejilla: la disponibilidad es informativa', async () => {
    const e = await escena()
    const baja = await crearZonaBaja(e.comunidad)

    const res = await request(app())
      .get(`/api/v1/common-areas/${baja}/availability?date=2026-10-10`)
      .set('Authorization', e.vecino.token)

    expect(res.status).toBe(200)
    expect(res.body.data.slots).toHaveLength(14)
  })
})
