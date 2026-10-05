// ---------------------------------------------------------------------------
// Miembros e invitaciones, contra la base de datos real.
//
// No hay mocks, y aqui no podrian sustituirlos: la mitad de lo que se comprueba es
// que las politicas de RLS filtran de verdad, que el invariante de M-3 vive DENTRO
// de la funcion de SQL y no en la capa HTTP, y que un INSERT directo a
// `community_members` lo rechaza el motor. Un mock pasaria aunque las politicas
// estuvieran rotas, que es justo el fallo que estos tests existen para detectar.
//
// El criterio es asimetrico, y por eso los asserts miran las DOS caras: que la API
// responde lo que tiene que responder Y que la tabla quedo como tiene que quedar.
// Un 409 que llega despues de escribir pasaria el primer assert y dejaria el
// estado cambiado.
//
// Cubre los criterios de aceptacion de la seccion 9 de la spec 03.
// ---------------------------------------------------------------------------

import { createHash, randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { admin } from '../db-admin.js'
import { withContext } from '../context.js'
import {
  app,
  createUser,
  deleteCommunity,
  deleteUser,
  makeAdmin,
  makeCommunity,
  makeMember,
  readInvitations,
  readMembership,
  uniqueEmail,
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

/** Crea un usuario que se limpia solo al terminar cada test. */
async function nuevoUsuario(overrides: { email?: string; fullName?: string } = {}): Promise<TestUser> {
  const user = await createUser(overrides)
  usuarios.push(user.id)
  return user
}

/**
 * Crea una comunidad que se limpia sola.
 *
 * Se registra en `comunidades` y no en `usuarios` porque el borrado de la comunidad
 * arrastra en cascada sus membresias y sus invitaciones: borrar los tres por
 * separado seria trabajo de mas y, si una de las tres veces falla, dejaria datos de
 * un test en el siguiente.
 */
async function nuevaComunidad(nombre: string): Promise<string> {
  const id = await makeCommunity(nombre)
  comunidades.push(id)
  return id
}

/** Entra y devuelve la cabecera de autorizacion. */
async function tokenDe(user: TestUser): Promise<string> {
  const res = await request(app())
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: user.password })
  expect(res.status).toBe(200)
  return `Bearer ${res.body.data.accessToken}`
}

type Actor = TestUser & { token: string }

/**
 * El escenario de la mayoria de los tests: una comunidad con un ADMIN y un
 * NEIGHBOR, los dos con sesion.
 *
 * Se construye con una funcion y no con un `beforeEach` de variables sueltas porque
 * el rol del primer actor dice lo que el test necesita saber: casi todas las rutas
 * de este bloque separan `ADMIN` del resto, y tener que subir a mirar una llamada a
 * `makeMember` para saber si el actor puede o no es justo lo que un test debe
 * evitar. Con `rolAdmin: 'PRESIDENT'` se renombra al destructurar y queda claro.
 */
async function escenario(
  opciones: { rolAdmin?: 'ADMIN' | 'PRESIDENT' | 'NEIGHBOR' } = {},
): Promise<{ comunidad: string; admin: Actor; vecino: Actor }> {
  const comunidad = await nuevaComunidad('Comunidad de prueba')

  const primero = await nuevoUsuario({ fullName: 'Admin de Prueba' })
  await makeMember(primero.id, comunidad, opciones.rolAdmin ?? 'ADMIN')

  const segundo = await nuevoUsuario({ fullName: 'Vecino de Prueba' })
  await makeMember(segundo.id, comunidad, 'NEIGHBOR')

  return {
    comunidad,
    admin: { ...primero, token: await tokenDe(primero) },
    vecino: { ...segundo, token: await tokenDe(segundo) },
  }
}

/** Invita a un correo y devuelve el id de la invitacion y el codigo en claro. */
async function invitar(token: string, comunidad: string, email: string): Promise<{ id: string; code: string }> {
  const res = await request(app()).post(`${COM}/${comunidad}/invitations`).set('Authorization', token).send({ email })
  expect(res.status, `invitando a ${email}`).toBe(201)
  return { id: res.body.data.id, code: res.body.data.code }
}

/**
 * La peticion de canje, SIN `await`.
 *
 * Se devuelve el objeto `Test` de supertest, que es a la vez THENable y admite
 * `.expect(...)`. Con un `await` dentro, el helper devolveria la respuesta ya
 * resuelta y `canjear(...).expect(201)` dejaria de existir. Se puede usar igual:
// `await canjear(token, codigo)` y `await canjear(token, codigo).expect(201)`.
 */
function canjear(token: string, code: string) {
  return request(app()).post('/api/v1/invitations/redeem').set('Authorization', token).send({ code })
}

/** El `id` de la membresia de un usuario en una comunidad. */
async function memberIdDe(userId: string, communityId: string): Promise<string> {
  const fila = await admin.communityMembers.findFirstOrThrow({
    where: { community_id: communityId, user_id: userId },
    select: { id: true },
  })
  return fila.id
}

// ---------------------------------------------------------------------------
// Listado y detalle
// ---------------------------------------------------------------------------

describe('GET /communities/:communityId/members', () => {
  it('devuelve los miembros con nombre, email, rol y estado', async () => {
    const { comunidad, admin: adminA, vecino } = await escenario()

    const res = await request(app()).get(`${COM}/${comunidad}/members`).set('Authorization', adminA.token)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(2)

    const propio = res.body.data.find((m: { userId: string }) => m.userId === adminA.id)
    // `id` es el de la MEMBRESIA y `userId` el de la cuenta: son dos filas
    // distintas, y un endpoint que devolviera solo uno invitaria a confundirlos.
    expect(propio).toMatchObject({
      userId: adminA.id,
      fullName: 'Admin de Prueba',
      email: adminA.email,
      role: 'ADMIN',
      status: 'ACTIVE',
      unitNumber: null,
    })
    expect(propio.id).not.toBe(propio.userId)
    // Fechas ISO en texto, no el `toJSON` raro de un Date sinerializado.
    expect(typeof propio.joinedAt).toBe('string')

    expect(res.body.data.some((m: { userId: string }) => m.userId === vecino.id)).toBe(true)
  })

  it('es de cualquier miembro, no solo del ADMIN', async () => {
    // El caso de uso principal: "¿el tecnico ya tiene acceso?". Y el PROVIDER lo
    // necesita para saber a quien esperar (spec 03, seccion 6).
    const { comunidad, vecino } = await escenario()

    const res = await request(app()).get(`${COM}/${comunidad}/members`).set('Authorization', vecino.token)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(2)
  })

  it('incluye tambien a los SUSPENDED y a los LEFT, con su estado a la vista', async () => {
    const { comunidad, admin: adminA } = await escenario()

    const suspendido = await nuevoUsuario({ fullName: 'Suspendido' })
    await makeMember(suspendido.id, comunidad, 'PRESIDENT')
    await admin.communityMembers.updateMany({
      where: { community_id: comunidad, user_id: suspendido.id },
      data: { status: 'SUSPENDED' },
    })

    const ida = await nuevoUsuario({ fullName: 'Ida' })
    await makeMember(ida.id, comunidad, 'NEIGHBOR')
    await admin.communityMembers.updateMany({
      where: { community_id: comunidad, user_id: ida.id },
      data: { status: 'LEFT' },
    })

    const res = await request(app()).get(`${COM}/${comunidad}/members`).set('Authorization', adminA.token)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(4)

    const porUser = Object.fromEntries(res.body.data.map((m: { userId: string; status: string }) => [m.userId, m.status]))
    // SUSPENDED es visible, no secreto, y el historico es el punto de M-4.
    expect(porUser[suspendido.id]).toBe('SUSPENDED')
    expect(porUser[ida.id]).toBe('LEFT')
    // Y el rol se conserva en el suspendido, que es lo que hace util el levantarlo.
    const fila = res.body.data.find((m: { userId: string }) => m.userId === suspendido.id)
    expect(fila.role).toBe('PRESIDENT')
  })

  it('un vecino de A que pide los miembros de B recibe 403 y ningun dato de B', async () => {
    const vecino = await nuevoUsuario({ fullName: 'Vecino de A' })

    const a = await nuevaComunidad('Comunidad A')
    const b = await nuevaComunidad('Comunidad B')
    await makeMember(vecino.id, a, 'NEIGHBOR')

    const deB = await nuevoUsuario({ fullName: 'Secreto de B' })
    await makeMember(deB.id, b, 'ADMIN')

    const res = await request(app())
      .get(`${COM}/${b}/members`)
      .set('Authorization', await tokenDe(vecino))

    expect(res.status).toBe(403)
    // Ni el nombre ni el email del vecino de B. Un 403 con un dato dentro es un 403
    // decorativo.
    expect(JSON.stringify(res.body)).not.toContain('Secreto de B')
    expect(res.body.data).toBeUndefined()
  })

  it('un UUID mal formado da 400 y no 403 (C-9)', async () => {
    const { admin: adminA } = await escenario()

    for (const malo of ['no-es-un-uuid', '123', '1234-5678']) {
      const res = await request(app()).get(`${COM}/${malo}/members`).set('Authorization', adminA.token)
      expect(res.status, `con id ${JSON.stringify(malo)}`).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('sin token da 401', async () => {
    const { comunidad } = await escenario()
    const res = await request(app()).get(`${COM}/${comunidad}/members`)
    expect(res.status).toBe(401)
  })
})

describe('GET /communities/:communityId/members/:memberId', () => {
  it('devuelve un miembro con el envelope', async () => {
    const { comunidad, admin: adminA, vecino } = await escenario()
    const memberId = await memberIdDe(vecino.id, comunidad)

    const res = await request(app())
      .get(`${COM}/${comunidad}/members/${memberId}`)
      .set('Authorization', adminA.token)

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ id: memberId, userId: vecino.id, role: 'NEIGHBOR' })
  })

  it('un memberId de otra comunidad da 404 y no 403 (C-8)', async () => {
    const adminA = await nuevoUsuario()
    const a = await nuevaComunidad('Comunidad A')
    const b = await nuevaComunidad('Comunidad B')
    await makeAdmin(adminA.id, a)

    const deB = await nuevoUsuario()
    await makeMember(deB.id, b, 'NEIGHBOR')

    // El memberId de la membresia en B. Para A, esta fila no existe.
    const res = await request(app())
      .get(`${COM}/${a}/members/${await memberIdDe(deB.id, b)}`)
      .set('Authorization', await tokenDe(adminA))

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('un memberId mal formado da 400', async () => {
    const { comunidad, admin: adminA } = await escenario()

    const res = await request(app())
      .get(`${COM}/${comunidad}/members/no-es-un-uuid`)
      .set('Authorization', adminA.token)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})

// ---------------------------------------------------------------------------
// PATCH de rol y estado
// ---------------------------------------------------------------------------

describe('PATCH /communities/:communityId/members/:memberId', () => {
  it('el ADMIN cambia un rol y el efecto se ve en la fila', async () => {
    const { comunidad, admin: adminA, vecino } = await escenario()
    const memberId = await memberIdDe(vecino.id, comunidad)

    const res = await request(app())
      .patch(`${COM}/${comunidad}/members/${memberId}`)
      .set('Authorization', adminA.token)
      .send({ role: 'PRESIDENT' })

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ id: memberId, role: 'PRESIDENT', status: 'ACTIVE' })

    // Y en la tabla, no solo en la respuesta. Un 200 con el cuerpo inventado pasaria
    // el assert anterior.
    expect((await readMembership(vecino.id, comunidad))?.role).toBe('PRESIDENT')
  })

  it('un PATCH de rol no toca el estado, y al reves', async () => {
    // El fallo que aparecio ya en el bloque 02: un campo con transform en zod 4
    // aparece en la salida aunque no venga, y el servicio escribiria un status que
    // nadie mando.
    const { comunidad, admin: adminA, vecino } = await escenario()
    const memberId = await memberIdDe(vecino.id, comunidad)

    await request(app())
      .patch(`${COM}/${comunidad}/members/${memberId}`)
      .set('Authorization', adminA.token)
      .send({ status: 'SUSPENDED' })
    expect((await readMembership(vecino.id, comunidad))?.status).toBe('SUSPENDED')

    await request(app())
      .patch(`${COM}/${comunidad}/members/${memberId}`)
      .set('Authorization', adminA.token)
      .send({ role: 'PROVIDER' })

    const fila = await readMembership(vecino.id, comunidad)
    expect(fila?.role).toBe('PROVIDER')
    expect(fila?.status).toBe('SUSPENDED')
  })

  it('levantar la suspension devuelve a alguien a su rol anterior (M-5)', async () => {
    const { comunidad, admin: adminA, vecino } = await escenario()
    const memberId = await memberIdDe(vecino.id, comunidad)

    await request(app())
      .patch(`${COM}/${comunidad}/members/${memberId}`)
      .set('Authorization', adminA.token)
      .send({ role: 'PROVIDER' })
    await request(app())
      .patch(`${COM}/${comunidad}/members/${memberId}`)
      .set('Authorization', adminA.token)
      .send({ status: 'SUSPENDED' })

    const res = await request(app())
      .patch(`${COM}/${comunidad}/members/${memberId}`)
      .set('Authorization', adminA.token)
      .send({ status: 'ACTIVE' })

    expect(res.status).toBe(200)
    // El rol se conserva: suspender no degrada (M-5).
    expect(res.body.data).toMatchObject({ role: 'PROVIDER', status: 'ACTIVE' })
  })

  it('el ultimo ADMIN no puede degradarse: 409 y su fila intacta (M-3)', async () => {
    const { comunidad, admin: adminA } = await escenario()

    const res = await request(app())
      .patch(`${COM}/${comunidad}/members/${await memberIdDe(adminA.id, comunidad)}`)
      .set('Authorization', adminA.token)
      .send({ role: 'NEIGHBOR' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
    // El mensaje tiene que decir QUE hacer, no solo que no se puede: es la
    // diferencia entre un error accionable y un error sin salida.
    expect(res.body.error.message.toLowerCase()).toContain('admin')

    const fila = await readMembership(adminA.id, comunidad)
    expect(fila?.role).toBe('ADMIN')
    expect(fila?.status).toBe('ACTIVE')
  })

  it('el ultimo ADMIN no puede ni suspenderse ni irse a LEFT', async () => {
    const { comunidad, admin: adminA } = await escenario()

    for (const status of ['SUSPENDED', 'LEFT']) {
      const res = await request(app())
        .patch(`${COM}/${comunidad}/members/${await memberIdDe(adminA.id, comunidad)}`)
        .set('Authorization', adminA.token)
        .send({ status })

      expect(res.status, `con status ${status}`).toBe(409)
      expect((await readMembership(adminA.id, comunidad))?.status).toBe('ACTIVE')
    }
  })

  it('con dos ADMIN, uno si puede degradarse', async () => {
    // M-3 habla del ULTIMO. Con dos, quedarse con uno sigue siendo una comunidad
    // gobernable, asi que la operacion se permite.
    const { comunidad, admin: adminA } = await escenario()

    const segundo = await nuevoUsuario()
    await makeAdmin(segundo.id, comunidad)

    const res = await request(app())
      .patch(`${COM}/${comunidad}/members/${await memberIdDe(segundo.id, comunidad)}`)
      .set('Authorization', adminA.token)
      .send({ role: 'NEIGHBOR' })

    expect(res.status).toBe(200)
    expect((await readMembership(segundo.id, comunidad))?.role).toBe('NEIGHBOR')
  })

  it('"ultimo ADMIN" cuenta solo los ADMIN activos', async () => {
    // Un ADMIN suspendido no administra nada (`app_role_in()` filtra por estado), asi
    // que si queda uno suspendido y el otro se va, la comunidad se queda sin nadie.
    // La cuenta mira filas activas, no solo filas con role ADMIN.
    const { comunidad, admin: adminA } = await escenario()

    const suspendido = await nuevoUsuario()
    await makeAdmin(suspendido.id, comunidad)
    await admin.communityMembers.updateMany({
      where: { community_id: comunidad, user_id: suspendido.id },
      data: { status: 'SUSPENDED' },
    })

    const res = await request(app())
      .patch(`${COM}/${comunidad}/members/${await memberIdDe(adminA.id, comunidad)}`)
      .set('Authorization', adminA.token)
      .send({ role: 'NEIGHBOR' })

    // adminA es el unico ADMIN ACTIVO: no puede degradarse aunque exista otra fila
    // con role ADMIN.
    expect(res.status).toBe(409)
  })

  it('un NEIGHBOR recibe 403 y la fila no se toca', async () => {
    const { comunidad, admin: adminA, vecino } = await escenario()

    const res = await request(app())
      .patch(`${COM}/${comunidad}/members/${await memberIdDe(adminA.id, comunidad)}`)
      .set('Authorization', vecino.token)
      .send({ role: 'NEIGHBOR' })

    expect(res.status).toBe(403)
    expect((await readMembership(adminA.id, comunidad))?.role).toBe('ADMIN')
  })

  it('un PRESIDENT recibe 403 (M-2)', async () => {
    const { comunidad, admin: presidente } = await escenario({ rolAdmin: 'PRESIDENT' })

    const objetivo = await nuevoUsuario()
    await makeMember(objetivo.id, comunidad, 'NEIGHBOR')

    const res = await request(app())
      .patch(`${COM}/${comunidad}/members/${await memberIdDe(objetivo.id, comunidad)}`)
      .set('Authorization', presidente.token)
      .send({ role: 'PRESIDENT' })

    expect(res.status).toBe(403)
    expect((await readMembership(objetivo.id, comunidad))?.role).toBe('NEIGHBOR')
  })

  it('un ADMIN suspendido no administra', async () => {
    // `app_role_in()` filtra por estado activo, asi que un ADMIN suspendido es
    // indistinguible de un vecino para el guard de rol.
    const { comunidad, admin: adminA, vecino } = await escenario()

    await admin.communityMembers.updateMany({
      where: { community_id: comunidad, user_id: adminA.id },
      data: { status: 'SUSPENDED' },
    })

    const patch = await request(app())
      .patch(`${COM}/${comunidad}/members/${await memberIdDe(vecino.id, comunidad)}`)
      .set('Authorization', adminA.token)
      .send({ role: 'PRESIDENT' })
    expect(patch.status).toBe(403)

    const invite = await request(app())
      .post(`${COM}/${comunidad}/invitations`)
      .set('Authorization', adminA.token)
      .send({ email: uniqueEmail('suspendido') })
    expect(invite.status).toBe(403)

    expect((await readMembership(vecino.id, comunidad))?.role).toBe('NEIGHBOR')
  })

  it('un ADMIN de A que cambia un memberId de B recibe 404', async () => {
    const adminA = await nuevoUsuario()
    const a = await nuevaComunidad('Comunidad A')
    const b = await nuevaComunidad('Comunidad B')
    await makeAdmin(adminA.id, a)

    const deB = await nuevoUsuario()
    await makeMember(deB.id, b, 'NEIGHBOR')

    const res = await request(app())
      .patch(`${COM}/${a}/members/${await memberIdDe(deB.id, b)}`)
      .set('Authorization', await tokenDe(adminA))
      .send({ role: 'ADMIN' })

    // 404 y no 403: la membresia no existe EN ESTA comunidad. Un 403 confirmaria que
    // ese memberId es real en algun sitio.
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect((await readMembership(deB.id, b))?.role).toBe('NEIGHBOR')
  })

  it('el cuerpo { role, status } a la vez da 400 y no cambia nada', async () => {
    const { comunidad, admin: adminA, vecino } = await escenario()

    const res = await request(app())
      .patch(`${COM}/${comunidad}/members/${await memberIdDe(vecino.id, comunidad)}`)
      .set('Authorization', adminA.token)
      .send({ role: 'ADMIN', status: 'LEFT' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')

    const fila = await readMembership(vecino.id, comunidad)
    expect(fila?.role).toBe('NEIGHBOR')
    expect(fila?.status).toBe('ACTIVE')
  })

  it('un cuerpo vacio da 400', async () => {
    const { comunidad, admin: adminA, vecino } = await escenario()

    const res = await request(app())
      .patch(`${COM}/${comunidad}/members/${await memberIdDe(vecino.id, comunidad)}`)
      .set('Authorization', adminA.token)
      .send({})

    expect(res.status).toBe(400)
  })

  it('rechaza un rol que no existe con 400 y no con 500', async () => {
    // Sin el `::member_role` en la consulta, un valor fuera del enum llegaria a
    // Postgres y reventaria con 22P02. Aqui se traduce a un 400 legible.
    const { comunidad, admin: adminA, vecino } = await escenario()

    const res = await request(app())
      .patch(`${COM}/${comunidad}/members/${await memberIdDe(vecino.id, comunidad)}`)
      .set('Authorization', adminA.token)
      .send({ role: 'SUPERADMIN' })

    expect(res.status).toBe(400)
    expect((await readMembership(vecino.id, comunidad))?.role).toBe('NEIGHBOR')
  })
})

// ---------------------------------------------------------------------------
// Invitaciones
// ---------------------------------------------------------------------------

describe('POST /communities/:communityId/invitations', () => {
  it('el ADMIN invita y recibe el codigo en claro una sola vez', async () => {
    const { comunidad, admin: adminA } = await escenario()

    const res = await request(app())
      .post(`${COM}/${comunidad}/invitations`)
      .set('Authorization', adminA.token)
      .send({ email: '  Marta@Ejemplo.Test  ' })

    expect(res.status).toBe(201)
    expect(res.headers.location).toMatch(/\/invitations\/[0-9a-f-]{36}$/)
    // El correo se guarda en minusculas para que la comparacion del canje sea un `=`
    // directo (M-8).
    expect(res.body.data).toMatchObject({ email: 'marta@ejemplo.test', acceptedAt: null })
    // 64 hex, generados por el servidor.
    expect(res.body.data.code).toMatch(/^[0-9a-f]{64}$/)

    // Caduca a 7 dias (M-7) y no cuando el cliente quiera.
    const dias = (Date.parse(res.body.data.expiresAt) - Date.parse(res.body.data.createdAt)) / 86_400_000
    expect(dias).toBeCloseTo(7, 1)
  })

  it('la tabla NO guarda el codigo en claro, solo su hash', async () => {
    const { comunidad, admin: adminA } = await escenario()

    const { code } = await invitar(adminA.token, comunidad, uniqueEmail('hash'))

    const filas = await readInvitations(comunidad)
    expect(filas).toHaveLength(1)

    const fila = filas[0]!
    expect(fila.code_hash).toBe(createHash('sha256').update(code, 'utf8').digest('hex'))
    expect(fila.code_hash).not.toBe(code)
    // Ningun valor de la fila es el codigo. Sin esto, "el hash no es el codigo"
    // podria cumplirse con el codigo guardado en otra columna.
    expect(JSON.stringify(fila)).not.toContain(code)
  })

  it('un segundo POST para el mismo email da 409, y tras anular da 201 con otro codigo', async () => {
    const { comunidad, admin: adminA } = await escenario()
    const email = uniqueEmail('repetida')

    const primera = await invitar(adminA.token, comunidad, email)

    const segunda = await request(app())
      .post(`${COM}/${comunidad}/invitations`)
      .set('Authorization', adminA.token)
      .send({ email })
    expect(segunda.status).toBe(409)
    expect(segunda.body.error.code).toBe('CONFLICT')
    // No se pisa la anterior: sigue habiendo una, no dos.
    expect(await readInvitations(comunidad)).toHaveLength(1)

    await request(app())
      .delete(`${COM}/${comunidad}/invitations/${primera.id}`)
      .set('Authorization', adminA.token)
      .expect(204)

    const tercera = await invitar(adminA.token, comunidad, email)
    expect(tercera.code).not.toBe(primera.code)
  })

  it('un NEIGHBOR recibe 403 y no crea nada', async () => {
    const { comunidad, vecino } = await escenario()

    const res = await request(app())
      .post(`${COM}/${comunidad}/invitations`)
      .set('Authorization', vecino.token)
      .send({ email: uniqueEmail('no-permitido') })

    expect(res.status).toBe(403)
    // El 403 solo vale si no se ha creado nada.
    expect(await readInvitations(comunidad)).toHaveLength(0)
  })

  it('un PRESIDENT recibe 403 (M-2)', async () => {
    const { comunidad, admin: presidente } = await escenario({ rolAdmin: 'PRESIDENT' })

    const res = await request(app())
      .post(`${COM}/${comunidad}/invitations`)
      .set('Authorization', presidente.token)
      .send({ email: uniqueEmail('presidente') })

    expect(res.status).toBe(403)
    expect(await readInvitations(comunidad)).toHaveLength(0)
  })

  it('un ADMIN de A no puede invitar en B', async () => {
    const adminA = await nuevoUsuario()
    const a = await nuevaComunidad('A')
    const b = await nuevaComunidad('B')
    await makeAdmin(adminA.id, a)

    const res = await request(app())
      .post(`${COM}/${b}/invitations`)
      .set('Authorization', await tokenDe(adminA))
      .send({ email: uniqueEmail('ajena') })

    expect(res.status).toBe(403)
    expect(await readInvitations(b)).toHaveLength(0)
  })

  it('rechaza un correo invalido, un cuerpo vacio, un role y una caducidad con 400', async () => {
    const { comunidad, admin: adminA } = await escenario()

    const invalido = await request(app())
      .post(`${COM}/${comunidad}/invitations`)
      .set('Authorization', adminA.token)
      .send({ email: 'no-es-un-correo' })
    expect(invalido.status).toBe(400)

    const vacio = await request(app())
      .post(`${COM}/${comunidad}/invitations`)
      .set('Authorization', adminA.token)
      .send({})
    expect(vacio.status).toBe(400)

    // `role` en el alta seria dar control de la comunidad por un canal que no se
    // audita (M-9), y `expiresAt` dejaria que el cliente eligiera la caducidad.
    const conRole = await request(app())
      .post(`${COM}/${comunidad}/invitations`)
      .set('Authorization', adminA.token)
      .send({ email: uniqueEmail('rol'), role: 'ADMIN' })
    expect(conRole.status).toBe(400)

    const conCaducidad = await request(app())
      .post(`${COM}/${comunidad}/invitations`)
      .set('Authorization', adminA.token)
      .send({ email: uniqueEmail('caduca'), expiresAt: '2099-01-01T00:00:00.000Z' })
    expect(conCaducidad.status).toBe(400)

    expect(await readInvitations(comunidad)).toHaveLength(0)
  })
})

describe('GET /communities/:communityId/invitations', () => {
  it('el ADMIN ve las invitaciones, incluidas las ya usadas', async () => {
    const { comunidad, admin: adminA } = await escenario()

    const nuevo = await nuevoUsuario()
    const { code } = await invitar(adminA.token, comunidad, nuevo.email)
    await canjear(await tokenDe(nuevo), code).expect(201)

    const pendiente = await invitar(adminA.token, comunidad, uniqueEmail('pendiente'))

    const res = await request(app()).get(`${COM}/${comunidad}/invitations`).set('Authorization', adminA.token)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(2)
    // El codigo no se puede recuperar despues: en el listado no sale nunca.
    expect(JSON.stringify(res.body)).not.toContain(code)
    expect(JSON.stringify(res.body)).not.toContain(pendiente.code)

    // La usada sale con su fecha, que es lo que hace util tenerla ahi (M-4, M-11).
    const usada = res.body.data.find((i: { acceptedAt: string | null }) => i.acceptedAt !== null)
    expect(usada).toBeDefined()
  })

  it('un NEIGHBOR recibe 403 y no ve ningun correo invitado', async () => {
    const { comunidad, admin: adminA, vecino } = await escenario()
    const invitado = uniqueEmail('visible')
    await invitar(adminA.token, comunidad, invitado)

    const res = await request(app()).get(`${COM}/${comunidad}/invitations`).set('Authorization', vecino.token)

    expect(res.status).toBe(403)
    expect(JSON.stringify(res.body)).not.toContain(invitado)
  })
})

describe('DELETE /communities/:communityId/invitations/:invitationId', () => {
  it('anula una invitacion sin usar y responde 204', async () => {
    const { comunidad, admin: adminA } = await escenario()
    const { id } = await invitar(adminA.token, comunidad, uniqueEmail('anular'))

    const res = await request(app())
      .delete(`${COM}/${comunidad}/invitations/${id}`)
      .set('Authorization', adminA.token)

    expect(res.status).toBe(204)
    // 204 sin cuerpo: anular no deja recurso que leer y el envelope prohibe
    // `data: null` para que nadie lo lea como un fallo.
    expect(res.body).toEqual({})
    expect(await readInvitations(comunidad)).toHaveLength(0)
  })

  it('anular una invitacion ya usada da 409 y NO la borra (M-11)', async () => {
    const { comunidad, admin: adminA } = await escenario()

    const vecino = await nuevoUsuario()
    const { id, code } = await invitar(adminA.token, comunidad, vecino.email)
    await canjear(await tokenDe(vecino), code).expect(201)

    const res = await request(app())
      .delete(`${COM}/${comunidad}/invitations/${id}`)
      .set('Authorization', adminA.token)

    // 409 y no 404: la fila existe y es visible; lo que no se puede es deshacer un
    // canje.
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')

    const filas = await readInvitations(comunidad)
    expect(filas).toHaveLength(1)
    expect(filas[0]!.accepted_at).not.toBeNull()
  })

  it('una invitacion de otra comunidad da 404 y no se toca', async () => {
    // El actor administra LAS DOS comunidades, asi que la peticion pasa los guards.
    // Lo que se prueba es el `community_id` del filtro: la invitacion pertenece a B
    // y se pide por la ruta de A, asi que para A no existe.
    const adminAB = await nuevoUsuario()
    const a = await nuevaComunidad('A')
    const b = await nuevaComunidad('B')
    await makeAdmin(adminAB.id, a)
    await makeAdmin(adminAB.id, b)

    const token = await tokenDe(adminAB)
    const invitacionB = await invitar(token, b, uniqueEmail('de-b'))

    const res = await request(app())
      .delete(`${COM}/${a}/invitations/${invitacionB.id}`)
      .set('Authorization', token)

    // 404 y no 409: si devolviera 409 ("ya usada") confirmaria que ese id es real,
    // que es informacion sobre otra comunidad (C-8).
    expect(res.status).toBe(404)
    expect(await readInvitations(b)).toHaveLength(1)
  })

  it('un NEIGHBOR recibe 403', async () => {
    const { comunidad, admin: adminA, vecino } = await escenario()
    const { id } = await invitar(adminA.token, comunidad, uniqueEmail('protegida'))

    const res = await request(app())
      .delete(`${COM}/${comunidad}/invitations/${id}`)
      .set('Authorization', vecino.token)

    expect(res.status).toBe(403)
    expect(await readInvitations(comunidad)).toHaveLength(1)
  })

  it('un invitationId mal formado da 400', async () => {
    const { comunidad, admin: adminA } = await escenario()

    const res = await request(app())
      .delete(`${COM}/${comunidad}/invitations/no-es-un-uuid`)
      .set('Authorization', adminA.token)

    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// Canje
// ---------------------------------------------------------------------------

describe('POST /invitations/redeem', () => {
  it('un codigo valido da de alta al vecino como NEIGHBOR (M-9, M-10)', async () => {
    const { comunidad, admin: adminA } = await escenario()

    const vecino = await nuevoUsuario()
    const { code } = await invitar(adminA.token, comunidad, vecino.email)

    const res = await canjear(await tokenDe(vecino), code)

    expect(res.status).toBe(201)
    expect(res.body.data.communityId).toBe(comunidad)
    expect(res.headers.location).toMatch(/\/members\/[0-9a-f-]{36}$/)

    const fila = await readMembership(vecino.id, comunidad)
    expect(fila).toMatchObject({ role: 'NEIGHBOR', status: 'ACTIVE' })
    expect(fila!.id).toBe(res.body.data.memberId)
    expect(fila!.invited_by).toBe(adminA.id)

    // Y la invitacion queda marcada como usada, con quien la uso (M-4, M-11).
    const invitaciones = await readInvitations(comunidad)
    expect(invitaciones[0]!.accepted_at).not.toBeNull()
    expect(invitaciones[0]!.accepted_by).toBe(vecino.id)
  })

  it('un codigo usado da 400 en el segundo uso (M-6)', async () => {
    const { comunidad, admin: adminA } = await escenario()

    const vecino = await nuevoUsuario()
    const { code } = await invitar(adminA.token, comunidad, vecino.email)
    const token = await tokenDe(vecino)

    await canjear(token, code).expect(201)

    const segundo = await canjear(token, code)
    expect(segundo.status).toBe(400)
    expect(segundo.body.error.code).toBe('VALIDATION_ERROR')

    // Y no se ha creado una segunda membresia.
    expect(await admin.communityMembers.count({ where: { community_id: comunidad, user_id: vecino.id } })).toBe(1)
  })

  it('un codigo caducado da 400, no 403 (M-7)', async () => {
    const { comunidad, admin: adminA } = await escenario()

    const vecino = await nuevoUsuario()
    const { id, code } = await invitar(adminA.token, comunidad, vecino.email)

    // Se caducidad desde el lado privilegiado: la fecha la pone el servidor y no hay
    // ninguna API para caducarla a proposito.
    await admin.communityInvitations.update({
      where: { id },
      data: { expires_at: new Date(Date.now() - 60_000) },
    })

    const res = await canjear(await tokenDe(vecino), code)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(await readMembership(vecino.id, comunidad)).toBeNull()
  })

  it('un codigo inventado da 400 y no crea nada', async () => {
    const { comunidad } = await escenario()
    const antes = await admin.communityMembers.count({ where: { community_id: comunidad } })

    const vecino = await nuevoUsuario()
    const res = await canjear(await tokenDe(vecino), 'f'.repeat(64))

    expect(res.status).toBe(400)
    expect(await admin.communityMembers.count({ where: { community_id: comunidad } })).toBe(antes)
  })

  it('un codigo de otro email da 403 y no confirma que el codigo existe (M-8)', async () => {
    const { comunidad, admin: adminA } = await escenario()

    const interfecto = await nuevoUsuario()
    const { code } = await invitar(adminA.token, comunidad, 'quienSea@ejemplo.test')

    const res = await canjear(await tokenDe(interfecto), code)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    // Ni la membresia ni el consumo del codigo.
    expect(await readMembership(interfecto.id, comunidad)).toBeNull()
    expect((await readInvitations(comunidad))[0]!.accepted_at).toBeNull()
  })

  it('quien ya es ADMIN de otra comunidad entra aqui como NEIGHBOR', async () => {
    const { comunidad, admin: adminA } = await escenario()

    const otra = await nuevaComunidad('Comunidad del cargo')
    const vecino = await nuevoUsuario()
    await makeAdmin(vecino.id, otra)
    expect((await readMembership(vecino.id, otra))?.role).toBe('ADMIN')

    const { code } = await invitar(adminA.token, comunidad, vecino.email)
    await canjear(await tokenDe(vecino), code).expect(201)

    expect((await readMembership(vecino.id, comunidad))?.role).toBe('NEIGHBOR')
    // Y su ADMIN de la otra comunidad no se ha tocado.
    expect((await readMembership(vecino.id, otra))?.role).toBe('ADMIN')
  })

  it('un vecino que estaba SUSPENDED vuelve a ACTIVE, y como NEIGHBOR', async () => {
    // El unique (community_id, user_id) impide dos filas: un vecino que se va y
    // vuelve NO crea una fila nueva, se le actualiza el estado.
    const { comunidad, admin: adminA } = await escenario()

    const vecino = await nuevoUsuario()
    await makeMember(vecino.id, comunidad, 'PRESIDENT')
    await admin.communityMembers.updateMany({
      where: { community_id: comunidad, user_id: vecino.id },
      data: { status: 'SUSPENDED' },
    })

    const { code } = await invitar(adminA.token, comunidad, vecino.email)
    await canjear(await tokenDe(vecino), code).expect(201)

    const fila = await readMembership(vecino.id, comunidad)
    expect(fila?.status).toBe('ACTIVE')
    // Y vuelve como vecino, no como el PRESIDENT que era.
    expect(fila?.role).toBe('NEIGHBOR')
    expect(await admin.communityMembers.count({ where: { community_id: comunidad, user_id: vecino.id } })).toBe(1)
  })

  it('un codigo mete en una sola comunidad', async () => {
    // M-6: un codigo reutilizable en varias comunidades convertiria a quien lo tiene
    // en ADMIN_SA de hecho, sin ninguna de las garantias de app_is_global_admin().
    const { comunidad, admin: adminA } = await escenario()

    const otra = await nuevaComunidad('Otra comunidad')
    const vecino = await nuevoUsuario()

    const { code } = await invitar(adminA.token, comunidad, vecino.email)
    await canjear(await tokenDe(vecino), code).expect(201)

    expect(await readMembership(vecino.id, comunidad)).not.toBeNull()
    expect(await readMembership(vecino.id, otra)).toBeNull()
  })

  it('quien ya es miembro activo recibe 409 y el codigo no se consume', async () => {
    const { comunidad, admin: adminA } = await escenario()

    const vecino = await nuevoUsuario()
    await makeMember(vecino.id, comunidad, 'NEIGHBOR')
    const { code } = await invitar(adminA.token, comunidad, vecino.email)

    const res = await canjear(await tokenDe(vecino), code)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')

    // El codigo sigue sin usarse: el rechazo es por el estado, no por el codigo.
    expect((await readInvitations(comunidad))[0]!.accepted_at).toBeNull()
  })

  it('sin sesion da 401, y un cuerpo invalido da 400', async () => {
    const sinToken = await request(app()).post('/api/v1/invitations/redeem').send({ code: 'a'.repeat(64) })
    expect(sinToken.status).toBe(401)

    const { comunidad, admin: adminA } = await escenario()
    const vecino = await nuevoUsuario()
    const token = await tokenDe(vecino)

    const vacio = await request(app()).post('/api/v1/invitations/redeem').set('Authorization', token).send({})
    expect(vacio.status).toBe(400)

    // Con communityId el cliente no elige a que comunidad entra: 400, no 403.
    const conComunidad = await request(app())
      .post('/api/v1/invitations/redeem')
      .set('Authorization', token)
      .send({ code: 'a'.repeat(64), communityId: comunidad })
    expect(conComunidad.status).toBe(400)

    await invitar(adminA.token, comunidad, vecino.email)
  })

  it('quien no tiene membresia puede canjear, y el codigo decide la comunidad', async () => {
    // La razon de que /invitations/redeem no lleve requireCommunity: al canjear no se
    // sabe todavia en que comunidad se va a entrar.
    const { comunidad, admin: adminA } = await escenario()

    const sinMembresia = await nuevoUsuario()
    const { code } = await invitar(adminA.token, comunidad, sinMembresia.email)

    expect(await admin.communityMembers.count({ where: { user_id: sinMembresia.id } })).toBe(0)

    const res = await canjear(await tokenDe(sinMembresia), code)
    expect(res.status).toBe(201)
    expect(res.body.data.communityId).toBe(comunidad)
    expect(await admin.communityMembers.count({ where: { user_id: sinMembresia.id } })).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Suelo de la base de datos
// ---------------------------------------------------------------------------

describe('invariantes de la base de datos', () => {
  it('community_members NO tiene politica de INSERT, UPDATE ni DELETE', async () => {
    const filas = await admin.$queryRaw<Array<{ cmd: string }>>`
      select coalesce(p.cmd, 'NINGUNA') as cmd
        from pg_policies p
       where p.schemaname = 'public' and p.tablename = 'community_members'
    `

    // Y solo queda la de SELECT.
    expect(filas.map((f) => f.cmd).sort()).toEqual(['SELECT'])
  })

  it('app_runtime no tiene permiso de escritura en community_members', async () => {
    const filas = await admin.$queryRaw<Array<{ privilege_type: string }>>`
      select privilege_type
        from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'community_members'
         and grantee = 'app_runtime'
    `

    // Ni INSERT, ni UPDATE, ni DELETE. Es la segunda capa: aunque alguien dejara
    // pasar una politica, sin permiso la escritura ni siquiera llega a evaluarla.
    expect(filas.map((f) => f.privilege_type).sort()).toEqual(['SELECT'])
  })

  it('un INSERT directo con app_runtime falla y no crea la fila', async () => {
    const { comunidad, admin: adminA } = await escenario()
    const intruso = await nuevoUsuario()

    await expect(
      withContext({ userId: adminA.id, communityId: comunidad }, (tx) =>
        tx.$executeRawUnsafe(
          `insert into community_members (community_id, user_id, role)
           values ($1::uuid, $2::uuid, 'ADMIN')`,
          comunidad,
          intruso.id,
        ),
      ),
    ).rejects.toThrow(/42501|insufficient_privilege|permission denied|row-level security/i)

    // Sin permiso de INSERT, el motor responde permission denied antes incluso de
    // mirar RLS. Con `force row level security` seria "new row violates row-level
    // security". Los dos son 42501 y los dos son el final del camino.
    expect(await admin.communityMembers.count({ where: { community_id: comunidad, role: 'ADMIN' } })).toBe(1)
  })

  it('un UPDATE directo con app_runtime falla y no cambia el rol', async () => {
    // Este es el ataque que cierra quitar `members_update_admin`: elevar a ADMIN
    // saltandose el invariante de M-3.
    const { comunidad, admin: adminA, vecino } = await escenario()

    await expect(
      withContext({ userId: adminA.id, communityId: comunidad }, (tx) =>
        tx.$executeRawUnsafe(
          `update community_members set role = 'ADMIN' where community_id = $1::uuid and user_id = $2::uuid`,
          comunidad,
          vecino.id,
        ),
      ),
    ).rejects.toThrow(/42501|insufficient_privilege|permission denied|row-level security/i)

    expect((await readMembership(vecino.id, comunidad))?.role).toBe('NEIGHBOR')
  })

  it('un DELETE directo con app_runtime no borra ninguna membresia (M-4)', async () => {
    const { comunidad, admin: adminA, vecino } = await escenario()
    const antes = await admin.communityMembers.count({ where: { community_id: comunidad } })

    // community_members solo tiene SELECT para app_runtime, ni siquiera una politica
    // de DELETE hace falta: el permiso base ya lo impide. Lo que se comprueba es el
    // efecto, no el motivo, asi que se aceptan las dos formas de negarlo.
    await expect(
      withContext({ userId: adminA.id, communityId: comunidad }, (tx) =>
        tx.$executeRawUnsafe(
          `delete from community_members where community_id = $1::uuid and user_id = $2::uuid`,
          comunidad,
          vecino.id,
        ),
      ),
    ).rejects.toThrow(/42501|insufficient_privilege|permission denied|row-level security/i)

    expect(await admin.communityMembers.count({ where: { community_id: comunidad } })).toBe(antes)
    expect(await readMembership(vecino.id, comunidad)).not.toBeNull()
  })

  it('users_select_self no se toca: una consulta directa solo ve la fila propia', async () => {
    const { comunidad, admin: adminA, vecino } = await escenario()

    // La unica excepcion a esta politica es la funcion de lectura de la spec 03, que
    // exige ser miembro activo y devuelve dos columnas. Aqui se comprueba que la tabla
    // sigue siendo de solo lectura propia.
    const filas = await withContext({ userId: adminA.id, communityId: comunidad }, (tx) =>
      tx.users.findMany({ select: { id: true, email: true, full_name: true } }),
    )

    expect(filas).toHaveLength(1)
    expect(filas[0]!.id).toBe(adminA.id)
    expect(JSON.stringify(filas)).not.toContain(vecino.email)
  })

  it('la funcion de lectura si ve a los vecinos: es la excepcion acotada', async () => {
    const { comunidad, admin: adminA, vecino } = await escenario()

    const res = await request(app()).get(`${COM}/${comunidad}/members`).set('Authorization', adminA.token)

    expect(res.status).toBe(200)
    expect(res.body.data.map((m: { email: string }) => m.email)).toContain(vecino.email)
  })

  it('public, anon y authenticated no pueden ejecutar las seis funciones', async () => {
    // SECURITY DEFINER sin revoke a PUBLIC es una escalada esperando a ocurrir. Sin
    // sesion, `app_current_user_id()` es NULL, y una guarda mal escrita ahi pasaria
    // de largo para cualquier rol de Supabase.
    const firmas = [
      'app_get_community_member(uuid,uuid)',
      'app_list_community_members(uuid)',
      'app_invite_to_community(uuid,text)',
      'app_redeem_invitation(text)',
      'app_set_member_role(uuid,uuid,member_role)',
      'app_set_member_status(uuid,uuid,member_status)',
    ]

    for (const firma of firmas) {
      const filas = await admin.$queryRaw<Array<{ rol: string; puede: boolean }>>`
        select r.rolname as rol,
               has_function_privilege(r.oid, ${firma}, 'execute') as puede
          from pg_roles r
         where r.rolname in ('public', 'anon', 'authenticated', 'app_runtime')
         order by r.rolname
      `

      const porRol = Object.fromEntries(filas.map((f) => [f.rol, f.puede]))
      expect(porRol.public ?? false, `${firma} para public`).toBe(false)
      expect(porRol.anon ?? false, `${firma} para anon`).toBe(false)
      expect(porRol.authenticated ?? false, `${firma} para authenticated`).toBe(false)
      // El unico que puede es el rol de la aplicacion, y su unica puerta son las
      // guardas DENTRO de cada funcion.
      expect(porRol.app_runtime, `${firma} para app_runtime`).toBe(true)
    }
  })

  it('las seis funciones son SECURITY DEFINER con search_path fijo', async () => {
    const filas = await admin.$queryRaw<Array<{ routine_name: string; sec: boolean; cfg: string[] | null }>>`
      select p.proname as routine_name, p.prosecdef as sec, p.proconfig as cfg
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('app_get_community_member', 'app_list_community_members',
                           'app_invite_to_community', 'app_redeem_invitation',
                           'app_set_member_role', 'app_set_member_status')
    `

    expect(filas).toHaveLength(6)
    for (const f of filas) {
      expect(f.sec, f.routine_name).toBe(true)
      // Sin search_path fijo, un esquema escribible por delante podria ejecutar lo
      // que le plazca dentro de la funcion.
      expect(f.cfg?.join(','), f.routine_name).toContain('search_path=')
    }
  })

  it('app_redeem_invitation sin contexto de usuario falla con 42501', async () => {
    // La guarda vive DENTRO de la funcion, que es lo que importa: si viviera solo en
    // el middleware HTTP, la misma llamada se podria hacer por PostgREST.
    const { comunidad, admin: adminA } = await escenario()
    const { code } = await invitar(adminA.token, comunidad, uniqueEmail('sin-sesion'))

    await expect(
      withContext({ userId: null, communityId: null }, (tx) =>
        tx.$queryRawUnsafe('select app_redeem_invitation($1)', code),
      ),
    ).rejects.toThrow(/42501|insufficient_privilege|sin contexto de usuario/i)

    // Y el codigo no se ha consumido.
    expect((await readInvitations(comunidad))[0]!.accepted_at).toBeNull()
  })

  it('app_set_member_role con un actor que no es ADMIN falla con 42501', async () => {
    const { comunidad, vecino } = await escenario()

    // El objetivo es la membresia del otro actor, la del ADMIN del escenario.
    const objetivo = await admin.communityMembers.findFirstOrThrow({
      where: { community_id: comunidad, user_id: { not: vecino.id } },
      select: { id: true, user_id: true },
    })

    await expect(
      withContext({ userId: vecino.id, communityId: comunidad }, (tx) =>
        tx.$executeRawUnsafe(
          'select app_set_member_role($1::uuid, $2::uuid, $3::member_role)',
          comunidad,
          objetivo.id,
          'NEIGHBOR',
        ),
      ),
    ).rejects.toThrow(/42501|insufficient_privilege|solo un ADMIN/i)

    // Y el rol sigue como estaba: el rechazo es dentro de la transaccion.
    expect((await readMembership(objetivo.user_id, comunidad))?.role).toBe('ADMIN')
  })

  it('community_invitations no tiene politica de INSERT ni de UPDATE', async () => {
    // El alta la genera la funcion, que pone la caducidad y el accepted_at. Con una
    // politica, el cliente podria escribir expires_at (rompiendo M-7) o fingir una
    // invitacion ya usada.
    const filas = await admin.$queryRaw<Array<{ cmd: string }>>`
      select p.cmd
        from pg_policies p
       where p.schemaname = 'public' and p.tablename = 'community_invitations'
    `

    expect(filas.map((f) => f.cmd).sort()).toEqual(['DELETE', 'SELECT'])
  })

  it('la invitacion viva por email la garantiza un indice, no solo un if', async () => {
    const indices = await admin.$queryRaw<Array<{ nombre: string; unico: boolean; parcial: string | null }>>`
      select i.relname as nombre,
             ix.indisunique as unico,
             pg_get_expr(ix.indpred, ix.indrelid) as parcial
        from pg_index ix
        join pg_class i on i.oid = ix.indexrelid
       where ix.indrelid = 'community_invitations'::regclass
    `

    const vivo = indices.find((i) => i.nombre === 'community_invitations_live_uidx')
    expect(vivo?.unico).toBe(true)
    // Parcial sobre las no usadas: es lo que permite volver a invitar al mismo
    // correo DESPUES de que la invitacion anterior se haya usado.
    expect(vivo?.parcial).toContain('accepted_at IS NULL')
  })
})

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

describe('contrato HTTP', () => {
  it('los siete endpoints usan el envelope', async () => {
    const { comunidad, admin: adminA, vecino } = await escenario()

    const nuevo = await nuevoUsuario()
    const tokenNuevo = await tokenDe(nuevo)
    const { code } = await invitar(adminA.token, comunidad, nuevo.email)

    // 1. GET /members
    const listado = await request(app()).get(`${COM}/${comunidad}/members`).set('Authorization', adminA.token)
    expect(listado.body).toHaveProperty('data')
    expect(listado.body).not.toHaveProperty('error')

    // 2. POST /invitations
    const creada = await request(app())
      .post(`${COM}/${comunidad}/invitations`)
      .set('Authorization', adminA.token)
      .send({ email: uniqueEmail('envoltorio') })
    expect(creada.status).toBe(201)
    expect(creada.body).toHaveProperty('data')

    // 3. GET /invitations
    const invitaciones = await request(app())
      .get(`${COM}/${comunidad}/invitations`)
      .set('Authorization', adminA.token)
    expect(invitaciones.body).toHaveProperty('data')

    // 4. POST /invitations/redeem
    const canjeado = await canjear(tokenNuevo, code)
    expect(canjeado.status).toBe(201)
    expect(canjeado.body).toHaveProperty('data')
    const memberId = canjeado.body.data.memberId as string

    // 5. GET /members/:memberId
    const detalle = await request(app())
      .get(`${COM}/${comunidad}/members/${memberId}`)
      .set('Authorization', adminA.token)
    expect(detalle.body).toHaveProperty('data')

    // 6. PATCH /members/:memberId
    const parcheado = await request(app())
      .patch(`${COM}/${comunidad}/members/${memberId}`)
      .set('Authorization', adminA.token)
      .send({ role: 'PROVIDER' })
    expect(parcheado.body).toHaveProperty('data')

    // 7. DELETE /invitations/:invitationId
    const anulada = await request(app())
      .delete(`${COM}/${comunidad}/invitations/${creada.body.data.id}`)
      .set('Authorization', adminA.token)
    expect(anulada.status).toBe(204)

    // Y los errores llevan `error` con `code` y `message`, nunca `data`.
    const fallido = await request(app())
      .get(`${COM}/${comunidad}/members/${randomUUID()}`)
      .set('Authorization', adminA.token)
    expect(fallido.status).toBe(404)
    expect(fallido.body).toHaveProperty('error')
    expect(fallido.body.error.code).toBe('NOT_FOUND')
    expect(typeof fallido.body.error.message).toBe('string')
    expect(fallido.body.data).toBeUndefined()

    // El listado ya incluye al vecino recien llegado: tres en total.
    const final = await request(app()).get(`${COM}/${comunidad}/members`).set('Authorization', vecino.token)
    expect(final.body.data).toHaveLength(3)
  })

  it('GET /api/v1/communities sigue igual: no incluye miembros', async () => {
    const { comunidad, admin: adminA } = await escenario()

    const res = await request(app()).get(COM).set('Authorization', adminA.token)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    // Este bloque no ha tocado ese endpoint, y se comprueba: un `include:
    // { members: true }` colado aqui seria una fuga entre comunidades.
    expect(res.body.data[0]).not.toHaveProperty('members')
    expect(res.body.data[0]).not.toHaveProperty('communityMembers')
    expect(res.body.data[0].id).toBe(comunidad)
  })

  it('el registro no ha cambiado: sigue sin invitationCode (M-10)', async () => {
    const { comunidad, admin: adminA } = await escenario()
    const { code } = await invitar(adminA.token, comunidad, uniqueEmail('sin-registro'))

    const alta = await request(app())
      .post('/api/v1/auth/register')
      .send({ email: uniqueEmail('nuevo'), password: 'CommunityHub2026', fullName: 'Cuenta Nueva' })
    expect(alta.status).toBe(201)

    // Y el registro no acepta un codigo: con `.strict()` es un 400, no un canje por
    // la puerta de atras.
    const conCodigo = await request(app())
      .post('/api/v1/auth/register')
      .send({
        email: uniqueEmail('con-codigo'),
        password: 'CommunityHub2026',
        fullName: 'Con codigo',
        invitationCode: code,
      })

    expect(conCodigo.status).toBe(400)
  })
})