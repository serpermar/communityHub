// ---------------------------------------------------------------------------
// Reservas por API: alta, solape, confirmacion, cancelacion, listados y /me.
//
// Este es el archivo que demuestra que el bloque 06 hace lo que dice la spec.
// Los unitarios comprueban la FORMA de lo que entra; aqui lo que se comprueba
// es el COMPORTAMIENTO contra Postgres, y hay cinco cosas que solo se pueden
// demostrar aqui:
//
//   - R-6, el solape: dos peticiones al mismo hueco en la que UNA gana y la
//     otra recibe 409. En TypeScript eso seria un check-then-insert con una
//     ventana entre las dos, y la ventana es exactamente el fallo que el indice
//     unico existe para cerrar.
//   - La terna de rol del alta: el guard HTTP (NEIGHBOR/PRESIDENT/ADMIN) y la
//     funcion SQL (mismo rol dentro de la transaccion) tienen que dar el MISMO
//     403. Si uno de los dos desaparece, el otro sostiene el endpoint.
//   - La redaccion de `notes` (R-5): dueño/ADMIN/PRESIDENT ven el texto, el
//     resto recibe null. RLS no sabe redactar columnas, asi que esto vive en
//     CASEs de SQL y solo se puede observar leyendo por la API.
//   - La confirmacion con hueco robado: dos PENDING pueden compartir hueco (no
//     escriben slots); al confirmar la segunda despues de la primera, el indice
//     reviente con 409 y la segunda SIGUE PENDING.
//   - El borrado de slots al cancelar (R-4): cancelar y volver a mirar la
//     disponibilidad tiene que decir FREE otra vez.
//
// La regla de `helpers.ts` ("sembrar con privilegio, afirmar con restriccion")
// se cumple sin excepcion: los fixtures se crean con `admin` y todas las
// afirmaciones pasan por la API, es decir, por el rol de runtime con RLS.
//
// NOTA sobre los 404 de las rutas de zona: `POST /common-areas/:id/reservations`
// no lleva comunidad en la URL y `requireCommonArea()` resuelve la comunidad de
// la ZONA. Un id inexistente, el de otra comunidad, el de una comunidad a la que
// ya no perteneces o el de una zona de una comunidad donde estas SUSPENDIDO son
// el mismo 404, y por el mismo motivo (C-8): un 403 confirmaria que ese id
// existe y que antes si lo veias.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
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

const usuarios: string[] = []
const comunidades: string[] = []

// Las comunidades se borran en cada test; los usuarios, al final del archivo.
// Si se borraran en el afterEach, los actores de abajo no sobrevivirian al
// primer caso y habria que volver a crearlos (y a loguearlos) en cada uno.
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

/** Login una sola vez por usuario: el access token dura 15 minutos y la suite, menos. */
async function actor(user: TestUser): Promise<Actor> {
  return { ...user, token: await tokenDe(user) }
}

async function actorEn(
  user: TestUser,
  communityId: string,
  role: 'ADMIN' | 'PRESIDENT' | 'NEIGHBOR' | 'PROVIDER',
): Promise<Actor> {
  await makeMember(user.id, communityId, role)
  return { ...user, token: await tokenDe(user) }
}

/** Los cinco actores fijos del archivo, creados en la primera `escena()`. */
let actores: {
  admin: Actor
  presidente: Actor
  vecinoA: Actor
  vecinoB: Actor
  proveedor: Actor
} | null = null

/**
 * La comunidad con los cinco roles de este bloque.
 *
 * Los cinco USUARIOS se crean y se loguean UNA sola vez para todo el archivo;
 * lo que cada test crea y borra es la comunidad y las cinco MEMBRESIAS. Esa
 * reutilizacion no debilita ningun caso: la membresia es por comunidad
 * (`community_id + user_id`), que es exactamente lo que el `afterEach` se
 * carga, y por eso un test puede suspender a `vecinoB` sin que el siguiente lo
 * herede —el siguiente vuelve a crear su fila con estado `ACTIVE`.
 *
 * Ademas hace falta por una razon no negociable: el rate limit global son 300
 * peticiones cada 15 minutos por IP, y una instancia por test con cinco
 * logins cada uno pasaria de ese techo sin que ningun test este midiendo nada
 * interesante. Cinco logins en el archivo entero dejan margen de sobra.
 */
async function escena(): Promise<{
  comunidad: string
  admin: Actor
  presidente: Actor
  vecinoA: Actor
  vecinoB: Actor
  proveedor: Actor
}> {
  const comunidad = await nuevaComunidad()

  if (!actores) {
    actores = {
      admin: await actor(await nuevoUsuario({ fullName: 'Administradora' })),
      presidente: await actor(await nuevoUsuario({ fullName: 'Presidente' })),
      vecinoA: await actor(await nuevoUsuario({ fullName: 'Vecina A' })),
      vecinoB: await actor(await nuevoUsuario({ fullName: 'Vecino B' })),
      proveedor: await actor(await nuevoUsuario({ fullName: 'Proveedor' })),
    }
  }

  await makeMember(actores.admin.id, comunidad, 'ADMIN')
  await makeMember(actores.presidente.id, comunidad, 'PRESIDENT')
  await makeMember(actores.vecinoA.id, comunidad, 'NEIGHBOR')
  await makeMember(actores.vecinoB.id, comunidad, 'NEIGHBOR')
  await makeMember(actores.proveedor.id, comunidad, 'PROVIDER')

  return { comunidad, ...actores }
}

/** Un usuario sin comunidad, para los 403/404 de fuera. */
async function outsider(): Promise<Actor> {
  const user = await nuevoUsuario({ fullName: 'De fuera' })
  return { ...user, token: await tokenDe(user) }
}

/** Una zona creada por la API con el ADMIN. Devuelve su id. */
async function crearZona(token: string, comunidad: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await request(app())
    .post(`${V1}/communities/${comunidad}/common-areas`)
    .set('Authorization', token)
    .send({ name: `Zona ${randomUUID().slice(0, 8)}`, ...extra })
  expect(res.status, `creando zona: ${JSON.stringify(res.body)}`).toBe(201)
  return res.body.data.id
}

/**
 * Un instante futuro a hora UTC entera.
 *
 * Con rejilla de 60 minutos y desfase horario de Madrid de UNA hora entera
 * (+1 o +2 segun el mes), cualquier hora UTC entera cae SIEMPRE en la rejilla
 * local. Y entre las 07:00 y las 19:00 UTC la reserva cabe siempre dentro de
 * 08:00-22:00 locales, tanto en invierno (+1: 08:00-20:00) como en verano
 * (+2: 09:00-21:00), sin importar en que dia del ano caiga la suite.
 */
function enFuturo(dias: number, horaUtc: number, minuto = 0): Date {
  const d = new Date(Date.now() + dias * 86_400_000)
  d.setUTCHours(horaUtc, minuto, 0, 0)
  return d
}

/** El dia (YYYY-MM-DD) de un instante, para los filtros `?date`. */
function diaDe(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** El alta minima valida. */
function altaValida(inicio: Date, extra: Record<string, unknown> = {}) {
  return {
    startsAt: inicio.toISOString(),
    endsAt: new Date(inicio.getTime() + 3_600_000).toISOString(),
    ...extra,
  }
}

/** Crea una reserva y devuelve la respuesta entera, sin asumir el status. */
async function reservar(token: string, zona: string, body: Record<string, unknown>) {
  return request(app()).post(`${V1}/common-areas/${zona}/reservations`).set('Authorization', token).send(body)
}

/** La disponibilidad de un dia, para comprobar slots desde fuera. */
async function disponibilidad(token: string, zona: string, fecha: string) {
  const res = await request(app())
    .get(`${V1}/common-areas/${zona}/availability?date=${fecha}`)
    .set('Authorization', token)
  expect(res.status).toBe(200)
  return res.body.data.slots as Array<{ startsAt: string; status: string }>
}

// ---------------------------------------------------------------------------

describe('Alta de reservas (R-1, R-2, R-7)', () => {
  it('una zona sin aprobacion nace CONFIRMED, ocupa el calendario y devuelve Location', async () => {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad)
    const inicio = enFuturo(7, 10)

    const res = await reservar(e.vecinoA.token, zona, altaValida(inicio))

    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body.data.status).toBe('CONFIRMED')
    expect(res.body.data.communityId).toBe(e.comunidad)
    expect(res.body.data.userId).toBe(e.vecinoA.id)
    expect(res.body.data.userName).toBe('Vecina A')
    expect(res.body.data.notes).toBeNull()
    expect(res.headers.location).toBe(`${V1}/reservations/${res.body.data.id}`)

    // R-2: CONFIRMED escribe sus slots, asi que el hueco ya no esta libre.
    const slots = await disponibilidad(e.vecinoA.token, zona, diaDe(inicio))
    const ocupados = slots.filter((s) => s.status === 'OCCUPIED')
    expect(ocupados).toHaveLength(1)
    expect(ocupados[0]?.startsAt).toBe(inicio.toISOString())
  })

  it('una zona con aprobacion nace PENDING y NO ocupa el calendario', async () => {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad, { requiresApproval: true })
    const inicio = enFuturo(7, 10)

    const res = await reservar(e.vecinoA.token, zona, altaValida(inicio))

    expect(res.status).toBe(201)
    expect(res.body.data.status).toBe('PENDING')

    // R-2: una PENDING no escribe area_slots. Si lo hiciera, la cola de
    // aprobacion bloquearia huecos que todavia nadie ha concedido.
    const slots = await disponibilidad(e.vecinoA.token, zona, diaDe(inicio))
    expect(slots.every((s) => s.status === 'FREE')).toBe(true)
  })

  it('el status del cliente no se acepta: 400 por .strict()', async () => {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad)

    const res = await reservar(e.vecinoA.token, zona, {
      ...altaValida(enFuturo(7, 10)),
      status: 'CONFIRMED',
    })

    // R-2: el estado lo decide requires_approval de la zona. Aceptarlo del
    // cliente seria saltarse la aprobacion por un JSON.
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('un PROVIDER no reserva (R-1): 403 del guard de la ruta', async () => {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad)

    const res = await reservar(e.proveedor.token, zona, altaValida(enFuturo(7, 10)))

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('un no miembro recibe 404 en la ruta de zona, no 403', async () => {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad)
    const deFuera = await outsider()

    const res = await reservar(deFuera.token, zona, altaValida(enFuturo(7, 10)))

    // C-8: la zona no es visible para el, y un 403 confirmaria que existe.
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('un miembro suspendido pierde la zona (404) y el listado (403)', async () => {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad)

    const { admin } = await import('../db-admin.js')
    await admin.communityMembers.update({
      where: { community_id_user_id: { community_id: e.comunidad, user_id: e.vecinoB.id } },
      data: { status: 'SUSPENDED' },
    })

    // En la ruta de zona, la suspension quita VISIBILIDAD: la zona deja de ser
    // suya y el 404 es el mismo que el de un desconocido.
    const alta = await reservar(e.vecinoB.token, zona, altaValida(enFuturo(7, 10)))
    expect(alta.status).toBe(404)

    // En la ruta de comunidad, el guard dice "no es miembro": 403.
    const lista = await request(app())
      .get(`${V1}/communities/${e.comunidad}/reservations`)
      .set('Authorization', e.vecinoB.token)
    expect(lista.status).toBe(403)
  })

  it('las cinco reglas de negocio del alta son 400 y cada una nombra su problema', async () => {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad, { capacity: 2 })

    const casos: Array<[string, Date, Record<string, unknown>, string]> = [
      ['hora pasada', new Date(Date.now() - 3_600_000), {}, 'La reserva no puede empezar en el pasado.'],
      ['fuera de rejilla', enFuturo(7, 10, 30), {}, 'Las horas deben encajar en la rejilla de reservas de la zona.'],
      ['fuera de horario', enFuturo(7, 23), {}, 'La reserva cae fuera del horario de la zona.'],
      ['capacidad', enFuturo(7, 12), { attendees: 5 }, 'La asistencia supera la capacidad de la zona.'],
      ['orden', enFuturo(7, 14), { endsAt: enFuturo(7, 13).toISOString() }, 'El fin de la reserva debe ser posterior al inicio.'],
    ]

    for (const [nombre, inicio, extra, mensaje] of casos) {
      const res = await reservar(e.vecinoA.token, zona, altaValida(inicio, extra))

      expect(res.status, `con ${nombre}: ${JSON.stringify(res.body)}`).toBe(400)
      expect(res.body.error.code, `con ${nombre}`).toBe('VALIDATION_ERROR')
      expect(res.body.error.message, `con ${nombre}`).toBe(mensaje)
    }
  })

  it('una zona dada de baja no admite reservas', async () => {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad, { isActive: false })

    const res = await reservar(e.vecinoA.token, zona, altaValida(enFuturo(7, 10)))

    expect(res.status).toBe(400)
    expect(res.body.error.message).toBe('Esa zona común está dada de baja y no admite reservas.')
  })

  it('el cuerpo vacio es 400: los horarios no son opcionales', async () => {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad)

    const res = await reservar(e.vecinoA.token, zona, {})

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('Solape y concurrencia (R-6)', () => {
  it('la segunda reserva al mismo hueco recibe 409', async () => {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad)
    const inicio = enFuturo(7, 10)

    const primera = await reservar(e.vecinoA.token, zona, altaValida(inicio))
    expect(primera.status).toBe(201)

    const segunda = await reservar(e.vecinoB.token, zona, altaValida(inicio))

    // El 409 no es un "arregla el formulario": es "elige otra hora".
    expect(segunda.status).toBe(409)
    expect(segunda.body.error.code).toBe('CONFLICT')
  })

  it('dos peticiones SIMULTANEAS al mismo hueco: una 201 y otra 409', async () => {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad)
    const inicio = enFuturo(7, 11)

    const [a, b] = await Promise.all([
      reservar(e.vecinoA.token, zona, altaValida(inicio)),
      reservar(e.vecinoB.token, zona, altaValida(inicio)),
    ])

    const statuses = [a.status, b.status].sort((x, y) => x - y)

    // El corazon de R-6: entre el "está libre" y el insert de UNA de ellas
    // cabe la otra, y ninguna comprobacion en TypeScript lo veria. Gana quien
    // llegue al indice; la otra sale con 409 y la reserva de la ganadora
    // existe de verdad.
    expect(statuses).toEqual([201, 409])

    const ganadora = a.status === 201 ? a : b
    expect(ganadora.body.data.status).toBe('CONFIRMED')

    const lista = await request(app())
      .get(`${V1}/communities/${e.comunidad}/reservations`)
      .set('Authorization', e.admin.token)
    expect(lista.body.meta.total).toBe(1)
  })

  it('dos PENDING comparten hueco; al confirmar la segunda, 409 y sigue PENDING', async () => {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad, { requiresApproval: true })
    const inicio = enFuturo(7, 12)

    const una = await reservar(e.vecinoA.token, zona, altaValida(inicio))
    const otra = await reservar(e.vecinoB.token, zona, altaValida(inicio))
    expect(una.status).toBe(201)
    expect(otra.status).toBe(201)

    const confirmada = await request(app())
      .post(`${V1}/reservations/${una.body.data.id}/confirm`)
      .set('Authorization', e.admin.token)
      .send({})
    expect(confirmada.status).toBe(200)
    expect(confirmada.body.data.status).toBe('CONFIRMED')

    // El hueco lo acaba de tomar la primera. La segunda no puede confirmarse,
    // y —lo importante— NO queda confirmada a medias.
    const robada = await request(app())
      .post(`${V1}/reservations/${otra.body.data.id}/confirm`)
      .set('Authorization', e.admin.token)
      .send({})
    expect(robada.status).toBe(409)
    expect(robada.body.error.code).toBe('CONFLICT')

    const siguePendiente = await request(app())
      .get(`${V1}/reservations/${otra.body.data.id}`)
      .set('Authorization', e.admin.token)
    expect(siguePendiente.body.data.status).toBe('PENDING')
    expect(siguePendiente.body.data.cancelledAt).toBeNull()
  })
})

describe('Limite diario (R-7)', () => {
  it('la segunda CONFIRMED del mismo dia local es 400, aunque sea otra hora', async () => {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad, { maxDailyReservations: 1 })

    const primera = await reservar(e.vecinoA.token, zona, altaValida(enFuturo(7, 9)))
    expect(primera.status).toBe(201)

    const segunda = await reservar(e.vecinoB.token, zona, altaValida(enFuturo(7, 13)))

    expect(segunda.status).toBe(400)
    expect(segunda.body.error.message).toBe('Se ha alcanzado el límite diario de reservas de esa zona.')

    // Y al dia siguiente la plaza vuelve a estar.
    const manana = await reservar(e.vecinoB.token, zona, altaValida(enFuturo(8, 9)))
    expect(manana.status).toBe(201)
  })
})

describe('Confirmar (R-3)', () => {
  it('solo un ADMIN confirma: NEIGHBOR y PRESIDENT reciben 403', async () => {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad, { requiresApproval: true })
    const pendiente = await reservar(e.vecinoA.token, zona, altaValida(enFuturo(7, 10)))
    expect(pendiente.body.data.status).toBe('PENDING')
    const id = pendiente.body.data.id

    // El rol NO lo decide un guard de la ruta: lo decide
    // app_confirm_reservation() con la fila delante. Si desapareciera este
    // check, el endpoint seguiria protegido por la funcion, no al reves.
    for (const [nombre, actor] of [
      ['NEIGHBOR', e.vecinoA],
      ['PRESIDENT', e.presidente],
      ['PROVIDER', e.proveedor],
    ] as const) {
      const res = await request(app())
        .post(`${V1}/reservations/${id}/confirm`)
        .set('Authorization', actor.token)
        .send({})

      expect(res.status, `con rol ${nombre}`).toBe(403)
      expect(res.body.error.code, `con rol ${nombre}`).toBe('FORBIDDEN')
    }

    const admin = await request(app())
      .post(`${V1}/reservations/${id}/confirm`)
      .set('Authorization', e.admin.token)
      .send({})
    expect(admin.status).toBe(200)
    expect(admin.body.data.status).toBe('CONFIRMED')
  })

  it('confirmar dos veces es 409, y confirmar una cancelada tambien', async () => {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad, { requiresApproval: true })
    const pendiente = await reservar(e.vecinoA.token, zona, altaValida(enFuturo(7, 10)))
    const id = pendiente.body.data.id

    const confirmada = await request(app())
      .post(`${V1}/reservations/${id}/confirm`)
      .set('Authorization', e.admin.token)
      .send({})
    expect(confirmada.status).toBe(200)

    // Un 200 sin efecto dejaria al cliente sin saber si su primera
    // confirmacion llego.
    const otraVez = await request(app())
      .post(`${V1}/reservations/${id}/confirm`)
      .set('Authorization', e.admin.token)
      .send({})
    expect(otraVez.status).toBe(409)
    expect(otraVez.body.error.message).toBe('La reserva no está pendiente de confirmación.')

    // Cancelada y luego confirmada: tampoco. Revivirla no es un no-op.
    const cancelada = await request(app())
      .patch(`${V1}/reservations/${id}/cancel`)
      .set('Authorization', e.vecinoA.token)
      .send({})
    expect(cancelada.status).toBe(200)

    const revivida = await request(app())
      .post(`${V1}/reservations/${id}/confirm`)
      .set('Authorization', e.admin.token)
      .send({})
    expect(revivida.status).toBe(409)
  })
})

describe('Cancelar (R-4)', () => {
  it('el dueño cancela, la respuesta lo dice y el hueco se libera', async () => {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad)
    const inicio = enFuturo(7, 10)
    const creada = await reservar(e.vecinoA.token, zona, altaValida(inicio))
    const id = creada.body.data.id

    const res = await request(app())
      .patch(`${V1}/reservations/${id}/cancel`)
      .set('Authorization', e.vecinoA.token)
      .send({})

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('CANCELLED')
    expect(res.body.data.cancelledAt).not.toBeNull()

    // R-4: sin el DELETE de area_slots la piscina quedaria bloqueada para
    // siempre por una reserva que la app dice cancelada.
    const slots = await disponibilidad(e.vecinoA.token, zona, diaDe(inicio))
    expect(slots.every((s) => s.status === 'FREE')).toBe(true)
  })

  it('cancelar dos veces es 409', async () => {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad)
    const creada = await reservar(e.vecinoA.token, zona, altaValida(enFuturo(7, 10)))
    const id = creada.body.data.id

    const primera = await request(app())
      .patch(`${V1}/reservations/${id}/cancel`)
      .set('Authorization', e.vecinoA.token)
      .send({})
    expect(primera.status).toBe(200)

    const segunda = await request(app())
      .patch(`${V1}/reservations/${id}/cancel`)
      .set('Authorization', e.vecinoA.token)
      .send({})

    expect(segunda.status).toBe(409)
    expect(segunda.body.error.message).toBe('Esa reserva ya está cancelada.')
  })

  it('el dueño o un ADMIN cancelan; un tercero y un PRESIDENT reciben 403', async () => {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad)

    const deA = await reservar(e.vecinoA.token, zona, altaValida(enFuturo(7, 10)))
    const id = deA.body.data.id

    for (const [nombre, actor] of [
      ['NEIGHBOR ajeno', e.vecinoB],
      ['PRESIDENT', e.presidente],
      ['PROVIDER', e.proveedor],
    ] as const) {
      const res = await request(app())
        .patch(`${V1}/reservations/${id}/cancel`)
        .set('Authorization', actor.token)
        .send({})

      expect(res.status, `con ${nombre}`).toBe(403)
      expect(res.body.error.code, `con ${nombre}`).toBe('FORBIDDEN')
    }

    // Y la reserva sigue viva tras los tres intentos.
    const seguimiento = await request(app())
      .get(`${V1}/reservations/${id}`)
      .set('Authorization', e.vecinoA.token)
    expect(seguimiento.body.data.status).toBe('CONFIRMED')

    const admin = await request(app())
      .patch(`${V1}/reservations/${id}/cancel`)
      .set('Authorization', e.admin.token)
      .send({})
    expect(admin.status).toBe(200)
    expect(admin.body.data.status).toBe('CANCELLED')
  })

  it('cancelar o confirmar con cuerpo que no sea vacio es 400', async () => {
    const e = await escena()
    const zonaLibre = await crearZona(e.admin.token, e.comunidad)
    const zonaAprob = await crearZona(e.admin.token, e.comunidad, { requiresApproval: true })

    const creada = await reservar(e.vecinoA.token, zonaLibre, altaValida(enFuturo(7, 10)))
    const pendiente = await reservar(e.vecinoA.token, zonaAprob, altaValida(enFuturo(7, 11)))

    const cancel = await request(app())
      .patch(`${V1}/reservations/${creada.body.data.id}/cancel`)
      .set('Authorization', e.vecinoA.token)
      .send({ status: 'CANCELLED' })
    expect(cancel.status).toBe(400)

    const confirm = await request(app())
      .post(`${V1}/reservations/${pendiente.body.data.id}/confirm`)
      .set('Authorization', e.admin.token)
      .send({ status: 'CONFIRMED' })
    expect(confirm.status).toBe(400)

    // Sin cuerpo la operacion si va: un fetch sin body es el caso normal.
    const sinCuerpo = await request(app())
      .patch(`${V1}/reservations/${creada.body.data.id}/cancel`)
      .set('Authorization', e.vecinoA.token)
    expect(sinCuerpo.status).toBe(200)
  })
})

describe('Listado de comunidad y redaccion (R-5, R-10)', () => {
  /** Dos reservas: la de A con notes, la de B sin ellas. */
  async function conReservas(): Promise<{
    e: Awaited<ReturnType<typeof escena>>
    zona: string
    deA: string
    deB: string
    inicioA: Date
  }> {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad)
    const inicioA = enFuturo(7, 10)

    const a = await reservar(e.vecinoA.token, zona, altaValida(inicioA, { notes: 'Traigo la pata de mesa.', attendees: 3 }))
    const b = await reservar(e.vecinoB.token, zona, altaValida(enFuturo(7, 12), { notes: 'Notas de B.' }))
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)

    return { e, zona, deA: a.body.data.id, deB: b.body.data.id, inicioA }
  }

  it('cualquier miembro lee el listado con los nombres de comunidad, zona y autor', async () => {
    const { e } = await conReservas()

    for (const [nombre, actor] of [
      ['ADMIN', e.admin],
      ['PRESIDENT', e.presidente],
      ['NEIGHBOR', e.vecinoA],
      ['PROVIDER', e.proveedor],
    ] as const) {
      const res = await request(app())
        .get(`${V1}/communities/${e.comunidad}/reservations`)
        .set('Authorization', actor.token)

      expect(res.status, `con rol ${nombre}`).toBe(200)
      expect(res.body.data, `con rol ${nombre}`).toHaveLength(2)

      const primera = res.body.data[0]
      expect(primera.communityName, `con rol ${nombre}`).toBe('Comunidad de prueba')
      expect(primera.commonAreaName, `con rol ${nombre}`).toMatch(/^Zona /)
      expect(primera.userName, `con rol ${nombre}`).toBeTruthy()
    }
  })

  it('un no miembro recibe 403, no una lista vacia', async () => {
    const { e } = await conReservas()
    const deFuera = await outsider()

    const res = await request(app())
      .get(`${V1}/communities/${e.comunidad}/reservations`)
      .set('Authorization', deFuera.token)

    // "No hay reservas" confirmaria que la comunidad existe.
    expect(res.status).toBe(403)
  })

  it('las notas solo las ven el dueño, un ADMIN y un PRESIDENT (R-5)', async () => {
    const { e } = await conReservas()

    const deB = await request(app())
      .get(`${V1}/communities/${e.comunidad}/reservations`)
      .set('Authorization', e.vecinoB.token)

    expect(deB.status).toBe(200)
    const vistaDeB = deB.body.data.find((r: { id: string; userId: string }) => r.userId === e.vecinoA.id)
    expect(vistaDeB.notes).toBeNull()
    // La distincion entre "sin notas" y "no te las enseno" solo beneficiaria
    // a un atacante, asi que sale null en los dos casos.
    expect(vistaDeB.attendees).toBe(3)

    for (const [nombre, actor] of [
      ['dueña', e.vecinoA],
      ['ADMIN', e.admin],
      ['PRESIDENT', e.presidente],
    ] as const) {
      const res = await request(app())
        .get(`${V1}/communities/${e.comunidad}/reservations`)
        .set('Authorization', actor.token)
      const propia = res.body.data.find((r: { id: string; userId: string }) => r.userId === e.vecinoA.id)
      expect(propia.notes, `con ${nombre}`).toBe('Traigo la pata de mesa.')
    }
  })

  it('las canceladas no salen por defecto y si con ?status=CANCELLED (R-10)', async () => {
    const { e, deA } = await conReservas()

    const cancelada = await request(app())
      .patch(`${V1}/reservations/${deA}/cancel`)
      .set('Authorization', e.vecinoA.token)
      .send({})
    expect(cancelada.status).toBe(200)

    const porDefecto = await request(app())
      .get(`${V1}/communities/${e.comunidad}/reservations`)
      .set('Authorization', e.vecinoB.token)
    expect(porDefecto.body.data).toHaveLength(1)
    expect(porDefecto.body.data[0].userId).toBe(e.vecinoB.id)

    const canceladas = await request(app())
      .get(`${V1}/communities/${e.comunidad}/reservations?status=CANCELLED`)
      .set('Authorization', e.vecinoB.token)
    expect(canceladas.body.data).toHaveLength(1)
    expect(canceladas.body.data[0].id).toBe(deA)
    expect(canceladas.body.data[0].cancelledAt).not.toBeNull()
  })

  it('el filtro de fecha es el dia LOCAL de la comunidad (R-10)', async () => {
    const { e, zona, inicioA } = await conReservas()

    const elMismoDia = await request(app())
      .get(`${V1}/communities/${e.comunidad}/reservations?date=${diaDe(inicioA)}`)
      .set('Authorization', e.vecinoA.token)
    expect(elMismoDia.body.data).toHaveLength(2)

    const otroDia = await request(app())
      .get(`${V1}/communities/${e.comunidad}/reservations?date=${diaDe(new Date(inicioA.getTime() + 86_400_000))}`)
      .set('Authorization', e.vecinoA.token)
    expect(otroDia.body.data).toHaveLength(0)
    expect(otroDia.body.meta.total).toBe(0)

    // Y el filtro por zona, que convive con el de fecha.
    const porZona = await request(app())
      .get(`${V1}/communities/${e.comunidad}/reservations?commonAreaId=${zona}`)
      .set('Authorization', e.vecinoA.token)
    expect(porZona.body.data).toHaveLength(2)
  })

  it('los filtros con forma invalida son 400 antes de llegar a la base', async () => {
    const { e } = await conReservas()

    const casos = [
      'status=INVENTADO',
      'commonAreaId=no-es-uuid',
      'date=2026-2-5',
      'page=0',
      'limit=101',
      'otro=filtro',
    ]

    for (const query of casos) {
      const res = await request(app())
        .get(`${V1}/communities/${e.comunidad}/reservations?${query}`)
        .set('Authorization', e.vecinoA.token)

      expect(res.status, `con ${query}`).toBe(400)
      expect(res.body.error.code, `con ${query}`).toBe('VALIDATION_ERROR')
    }
  })

  it('la paginacion trae el total real incluso mas alla del final', async () => {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad)
    for (const hora of [8, 9, 10]) {
      const res = await reservar(e.vecinoA.token, zona, altaValida(enFuturo(7, hora)))
      expect(res.status).toBe(201)
    }

    const primera = await request(app())
      .get(`${V1}/communities/${e.comunidad}/reservations?limit=1&page=1`)
      .set('Authorization', e.vecinoA.token)

    expect(primera.body.data).toHaveLength(1)
    expect(primera.body.meta).toEqual({ page: 1, limit: 1, total: 3, totalPages: 3 })

    // Una pagina mas alla del final: sin el relleno del total, diria
    // "pagina 5 de 0", que no le sirve a nadie.
    const lejos = await request(app())
      .get(`${V1}/communities/${e.comunidad}/reservations?limit=1&page=5`)
      .set('Authorization', e.vecinoA.token)

    expect(lejos.body.data).toHaveLength(0)
    expect(lejos.body.meta.total).toBe(3)
    expect(lejos.body.meta.totalPages).toBe(3)
  })
})

describe('Detalle GET /reservations/:id', () => {
  it('el dueño ve las notas; otro miembro ve la reserva con notes null', async () => {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad)
    const creada = await reservar(e.vecinoA.token, zona, altaValida(enFuturo(7, 10), { notes: 'Solo la dueña.' }))
    const id = creada.body.data.id

    const propia = await request(app()).get(`${V1}/reservations/${id}`).set('Authorization', e.vecinoA.token)
    expect(propia.status).toBe(200)
    expect(propia.body.data.notes).toBe('Solo la dueña.')

    const ajena = await request(app()).get(`${V1}/reservations/${id}`).set('Authorization', e.vecinoB.token)
    expect(ajena.status).toBe(200)
    expect(ajena.body.data.notes).toBeNull()
    expect(ajena.body.data.userId).toBe(e.vecinoA.id)

    const presidente = await request(app()).get(`${V1}/reservations/${id}`).set('Authorization', e.presidente.token)
    expect(presidente.status).toBe(200)
    expect(presidente.body.data.notes).toBe('Solo la dueña.')
  })

  it('un no miembro recibe 404; un id sin UUID, 400; sin token, 401', async () => {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad)
    const creada = await reservar(e.vecinoA.token, zona, altaValida(enFuturo(7, 10)))
    const id = creada.body.data.id

    const deFuera = await outsider()
    const ajena = await request(app()).get(`${V1}/reservations/${id}`).set('Authorization', deFuera.token)
    expect(ajena.status).toBe(404)

    const sinUuid = await request(app()).get(`${V1}/reservations/no-es-uuid`).set('Authorization', e.vecinoA.token)
    expect(sinUuid.status).toBe(400)

    const sinToken = await request(app()).get(`${V1}/reservations/${id}`)
    expect(sinToken.status).toBe(401)
  })

  it('cancelar o confirmar la reserva de otra comunidad es 404', async () => {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad)
    const creada = await reservar(e.vecinoA.token, zona, altaValida(enFuturo(7, 10)))
    const id = creada.body.data.id

    const otra = await nuevaComunidad('Comunidad ajena')
    const adminDeOtra = await actorEn(await nuevoUsuario({ fullName: 'Admin ajeno' }), otra, 'ADMIN')

    // Un ADMIN de otra comunidad es ADMIN... pero de OTRA. Ni cancelar ni
    // confirmar pueden salir 403: eso confirmaria que la reserva existe.
    const cancel = await request(app())
      .patch(`${V1}/reservations/${id}/cancel`)
      .set('Authorization', adminDeOtra.token)
      .send({})
    expect(cancel.status).toBe(404)

    const confirm = await request(app())
      .post(`${V1}/reservations/${id}/confirm`)
      .set('Authorization', adminDeOtra.token)
      .send({})
    expect(confirm.status).toBe(404)
  })
})

describe('Agenda propia GET /reservations/me', () => {
  it('solo devuelve las reservas del que pregunta, cruzando comunidades', async () => {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad)

    const mia = await reservar(e.vecinoA.token, zona, altaValida(enFuturo(7, 10), { notes: 'Notas propias.' }))
    const suya = await reservar(e.vecinoB.token, zona, altaValida(enFuturo(7, 12)))
    expect(mia.status).toBe(201)
    expect(suya.status).toBe(201)

    // Una segunda comunidad donde vecinoA tambien es miembro: la agenda propia
    // es la de TODAS sus comunidades, y por eso no puede llevar :communityId.
    const otra = await nuevaComunidad('Comunidad vecina')
    await makeMember(e.vecinoA.id, otra, 'NEIGHBOR')
    const adminDeOtra = await actorEn(await nuevoUsuario({ fullName: 'Admin vecino' }), otra, 'ADMIN')
    const zonaOtra = await crearZona(adminDeOtra.token, otra)
    const enOtra = await reservar(e.vecinoA.token, zonaOtra, altaValida(enFuturo(8, 10)))
    expect(enOtra.status).toBe(201)

    const suAgenda = await request(app()).get(`${V1}/reservations/me`).set('Authorization', e.vecinoA.token)
    expect(suAgenda.status).toBe(200)
    expect(suAgenda.body.data).toHaveLength(2)
    expect(suAgenda.body.data.every((r: { userId: string }) => r.userId === e.vecinoA.id)).toBe(true)
    expect(suAgenda.body.data.map((r: { communityName: string }) => r.communityName).sort()).toEqual([
      'Comunidad de prueba',
      'Comunidad vecina',
    ])
    // Las suyas nunca se redactan: todas las filas son del llamante.
    expect(suAgenda.body.data[0].notes).not.toBeNull()

    const agendaDeB = await request(app()).get(`${V1}/reservations/me`).set('Authorization', e.vecinoB.token)
    expect(agendaDeB.body.data).toHaveLength(1)
    expect(agendaDeB.body.data[0].id).toBe(suya.body.data.id)
  })

  it('sin token es 401 y los filtros invalidos son 400', async () => {
    const e = await escena()

    const sinToken = await request(app()).get(`${V1}/reservations/me`)
    expect(sinToken.status).toBe(401)

    // meQuerySchema es strict: aqui NO hay commonAreaId ni date, porque el
    // ambito es el usuario y no hay comunidad en la ruta donde colgarlos.
    for (const query of ['status=INVENTADO', 'commonAreaId=otra-cosa', 'date=ayer', 'page=0']) {
      const res = await request(app()).get(`${V1}/reservations/me?${query}`).set('Authorization', e.vecinoA.token)
      expect(res.status, `con ${query}`).toBe(400)
    }
  })

  it('el filtro de estado funciona en la agenda propia', async () => {
    const e = await escena()
    const zona = await crearZona(e.admin.token, e.comunidad)

    const creada = await reservar(e.vecinoA.token, zona, altaValida(enFuturo(7, 10)))
    const cancelada = await request(app())
      .patch(`${V1}/reservations/${creada.body.data.id}/cancel`)
      .set('Authorization', e.vecinoA.token)
      .send({})
    expect(cancelada.status).toBe(200)

    const porDefecto = await request(app()).get(`${V1}/reservations/me`).set('Authorization', e.vecinoA.token)
    expect(porDefecto.body.data).toHaveLength(0)

    const canceladas = await request(app())
      .get(`${V1}/reservations/me?status=CANCELLED`)
      .set('Authorization', e.vecinoA.token)
    expect(canceladas.body.data).toHaveLength(1)
    expect(canceladas.body.data[0].id).toBe(creada.body.data.id)
  })
})
