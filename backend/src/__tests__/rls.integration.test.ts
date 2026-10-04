// ---------------------------------------------------------------------------
// Aislamiento entre comunidades, verificado contra la base de datos.
//
// Este es el test más importante del proyecto. El aislamiento es la propiedad de
// seguridad central: un vecino de la comunidad A no puede ver nada de la
// comunidad B. Si esto falla, todo lo demás es secundario.
//
// Se prueba a nivel de base de datos y no solo por la API, porque hay dos capas
// de defensa y hay que comprobar las dos:
//
//   1. RLS        -> la base de datos filtra, aunque la aplicación se equivoque
//   2. aplicación -> el código pide los datos con el community_id correcto
//
// Un test que solo pasara por la API no distinguiría cuál de las dos capas está
// rota. Y una de las dos puede fallar sin que nadie lo note: por eso se
// comprueban por separado.
//
// Cubre los criterios 12, 13 y 14 de la spec 01.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import express from 'express'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { prisma } from '../db.js'
import { withContext } from '../context.js'
import { requireAuth, requireCommunity } from '../auth/middleware.js'
import { errorHandler } from '../http/error-middleware.js'
import {
  app,
  createUser,
  deleteCommunity,
  deleteUser,
  makeCommunity,
  makeExpense,
  makeIncident,
  makeMember,
} from './helpers.js'

// Los fixtures se crean con el cliente admin (BYPASSRLS) porque app_runtime no
// puede crearlos. Lo que se afirma se hace siempre por el cliente de runtime.
const createdUsers: string[] = []
const createdCommunities: string[] = []

afterEach(async () => {
  while (createdCommunities.length > 0) {
    await deleteCommunity(createdCommunities.pop()!).catch(() => undefined)
  }
  while (createdUsers.length > 0) {
    await deleteUser(createdUsers.pop()!).catch(() => undefined)
  }
})

async function makeUser() {
  const user = await createUser()
  createdUsers.push(user.id)
  return user
}

async function community(name: string) {
  const id = await makeCommunity(name)
  createdCommunities.push(id)
  return id
}

/**
 * App sonda para probar `requireCommunity` sin inventar un endpoint de producto.
 *
 * El endpoint de incidencias todavía no existe, y writing a mano un
 * `GET /api/v1/communities/:id/incidents` que devolviera 403 sería escribir el
 * test a medida del resultado que se quiere ver. Esta app monta el middleware
 * real y el manejador de errores real sobre una ruta que solo existe en el test.
 *
 * Lo que se comprueba es el guardia, no la ruta.
 */
function probeApp() {
  const probe = express()
  probe.use(express.json())
  probe.get(
    '/sonda/:communityId',
    requireAuth,
    requireCommunity(),
    (req, res) => {
      res.json({ data: { communityId: req.community?.communityId, role: req.community?.role } })
    },
  )
  probe.use(errorHandler)
  return probe
}

async function loginAs(user: { email: string; password: string }): Promise<string> {
  const res = await request(app()).post('/api/v1/auth/login').send({
    email: user.email,
    password: user.password,
  })
  expect(res.status).toBe(200)
  return res.body.data.accessToken as string
}

describe('rol de conexión y RLS', () => {
  it('la conexión usa app_runtime y NO tiene BYPASSRLS', async () => {
    // Criterio 13. Con el rol postgres (o con BYPASSRLS) la aplicación
    // funcionaría igual de bien y devolvería datos de todas las comunidades.
    // Este test falla ruidosamente en esa configuración en vez de dejar que el
    // fallo se descubra en producción.
    // `rolbypassrls` es una columna de pg_roles, no una funcion: sin FROM no
    // existe. El cast a texto es necesario porque el booleano sale como 'false',
    // no como 'f'.
    const rows = await prisma.$queryRaw<Array<{ session_user: string; bypass: string }>>`
      select session_user::text as session_user, rolbypassrls::text as bypass
      from pg_roles
      where rolname = session_user
    `

    expect(rows[0]!.session_user).toMatch(/^app_runtime/)
    expect(rows[0]!.bypass).toBe('false')
  })

  it('sin set_config, las consultas de datos de comunidad devuelven 0 filas', async () => {
    // Criterio 14. Esta es la propiedad que hace que un fallo de la capa de
    // aplicación sea visible: si el contexto no se aplica, la consulta no
    // devuelve datos ajenos, devuelve nada. Falla ruidoso y cerrado en vez de
    // abierto y silencioso.
    const communityId = await community('Comunidad Sin Contexto')
    // La incidencia la reporta un usuario real: `incidents_reporter_id` es
    // clave foranea, y un UUID inventado haria fallar el fixture en vez de
    // probar lo que este test quiere probar.
    const reporter = await makeUser()
    await makeIncident(communityId, reporter.id, { title: 'Invisible sin contexto' })

    // A proposito `prisma` y no `admin`: lo que se comprueba es precisamente
    // que el cliente de la aplicación no ve nada sin contexto de RLS.
    const [incidents, users] = await Promise.all([
      prisma.incidents.count({ where: { community_id: communityId } }),
      prisma.users.count(),
    ])

    expect(incidents).toBe(0)
    expect(users).toBe(0)
  })
})

describe('aislamiento entre comunidades', () => {
  it('criterio 12 · un miembro de la comunidad A no lee las incidencias de la B', async () => {
    // Dos comunidades con un vecino cada una y una incidencia en la segunda.
    const userA = await makeUser()
    const userB = await makeUser()
    const communityA = await community('Comunidad A')
    const communityB = await community('Comunidad B')

    await makeMember(userA.id, communityA)
    await makeMember(userB.id, communityB)

    // Plantada con admin: el vecino B la ha creado, pero el admin la escribe
    // porque app_runtime no puede crear una incidencia ajena a su contexto.
    await makeIncident(communityB, userB.id, {
      title: 'Ascensor parado en la comunidad B',
      description: 'No debe ser visible desde la comunidad A.',
      category: 'ELEVATOR',
      priority: 'HIGH',
    })

    // Con el contexto de la comunidad A, la incidencia de B no aparece.
    const visibleFromA = await withContext({ userId: userA.id, communityId: communityA }, (tx) =>
      tx.incidents.findMany({ where: { community_id: communityB } }),
    )
    expect(visibleFromA).toHaveLength(0)

    // Y desde B sí aparece, lo que confirma que la consulta funciona y que lo
    // que se filtró fue el aislamiento, no un fallo de la consulta. Esta segunda
    // mitad es la que evita un falso positivo: un `toHaveLength(0)` que pasara
    // porque la consulta está mal escrita no probaría nada.
    const visibleFromB = await withContext({ userId: userB.id, communityId: communityB }, (tx) =>
      tx.incidents.findMany({ where: { community_id: communityB } }),
    )
    expect(visibleFromB).toHaveLength(1)
    expect(visibleFromB[0]!.title).toContain('comunidad B')
  })

  it('criterio 12 · dos vecinos de comunidades distintas no pueden leerse entre sí', async () => {
    const userA = await makeUser()
    const userB = await makeUser()
    const communityA = await community('Comunidad A Lectura')
    const communityB = await community('Comunidad B Lectura')

    await makeMember(userA.id, communityA)
    await makeMember(userB.id, communityB)

    // El usuario B intenta leer al usuario A.
    const readsA = await withContext({ userId: userB.id, communityId: communityB }, (tx) =>
      tx.users.findUnique({ where: { id: userA.id } }),
    )
    expect(readsA).toBeNull()

    // Y al revés.
    const readsB = await withContext({ userId: userA.id, communityId: communityA }, (tx) =>
      tx.users.findUnique({ where: { id: userB.id } }),
    )
    expect(readsB).toBeNull()

    // Cada uno sí se lee a sí mismo, porque `users_select_self` lo permite.
    const self = await withContext({ userId: userA.id, communityId: communityA }, (tx) =>
      tx.users.findUnique({ where: { id: userA.id } }),
    )
    expect(self).not.toBeNull()
  })

  it('criterio 12 · la lista de incidencias de la A nunca incluye las de la B', async () => {
    const userA = await makeUser()
    const communityA = await community('Comunidad A Lista')
    const communityB = await community('Comunidad B Lista')
    await makeMember(userA.id, communityA)

    await makeIncident(communityA, userA.id, { title: 'Fuga de agua en A', category: 'PLUMBING' })
    await makeIncident(communityB, userA.id, { title: 'Fuga de agua en B', category: 'PLUMBING' })

    const incidents = await withContext({ userId: userA.id, communityId: communityA }, (tx) =>
      tx.incidents.findMany({ select: { title: true } }),
    )

    expect(incidents.map((i) => i.title)).toEqual(['Fuga de agua en A'])
    expect(incidents.some((i) => i.title.includes('B'))).toBe(false)
  })

  it('criterio 12 · cambiar el communityId en la URL da 403, no los datos', async () => {
    // La versión del mismo requisito por la capa HTTP. `requireCommunity`
    // comprueba la pertenencia real, así que cambiar el id en la URL da 403 en
    // vez de devolver los datos de la otra comunidad.
    const intruder = await makeUser()
    const owner = await makeUser()
    const intruderCommunity = await community('Comunidad Intrusa')
    const victimCommunity = await community('Comunidad Víctima')

    await makeMember(intruder.id, intruderCommunity)
    await makeMember(owner.id, victimCommunity)
    await makeIncident(victimCommunity, owner.id, { title: 'Incidencia privada de la víctima' })

    const token = await loginAs(intruder)

    const denied = await request(probeApp())
      .get(`/sonda/${victimCommunity}`)
      .set('Authorization', `Bearer ${token}`)

    // 403 y no 404: el usuario existe y es miembro de la otra comunidad, así que
    // se le puede decir que no es suya sin filtrar nada.
    expect(denied.status).toBe(403)
    expect(denied.body.error.code).toBe('FORBIDDEN')

    // Y a la suya sí entra. Sin esta mitad, un `requireCommunity` roto que
    // rechazara siempre devolvería 403 y el test pasaría.
    const allowed = await request(probeApp())
      .get(`/sonda/${intruderCommunity}`)
      .set('Authorization', `Bearer ${token}`)
    expect(allowed.status).toBe(200)
    expect(allowed.body.data.role).toBe('NEIGHBOR')
  })

  it('un communityId mal formado da 400 sin llegar a consultar la base de datos', async () => {
    const user = await makeUser()
    const token = await loginAs(user)

    const res = await request(probeApp())
      .get('/sonda/no-es-un-uuid')
      .set('Authorization', `Bearer ${token}`)

    // 400 y no 403 (C-9): un id que no es un UUID no es una peticion sin
    // permiso, es una peticion mal formada. Este test afirmaba 403, asi que
    // dejaba de comprobar exactamente lo que C-9 cambia.
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('un ADMIN de una comunidad no ve los gastos de la otra', async () => {
    // El caso que motivó el rol PRESIDENT vs ADMIN en 02_rls.sql: el dinero es
    // el dato más sensible y el que más caro sale que se filtre.
    const adminA = await makeUser()
    const adminB = await makeUser()
    const communityA = await community('Comunidad A Dinero')
    const communityB = await community('Comunidad B Dinero')

    await makeMember(adminA.id, communityA, 'ADMIN')
    await makeMember(adminB.id, communityB, 'ADMIN')

    // `expenses` es de solo lectura para app_runtime: el fixture necesita admin.
    await makeExpense(communityB, adminB.id, 'Factura secreta de B')

    const expensesOfA = await withContext({ userId: adminA.id, communityId: communityA }, (tx) =>
      tx.expenses.findMany({ select: { concept: true } }),
    )
    expect(expensesOfA).toHaveLength(0)

    const expensesOfB = await withContext({ userId: adminB.id, communityId: communityB }, (tx) =>
      tx.expenses.findMany({ select: { concept: true } }),
    )
    expect(expensesOfB).toHaveLength(1)
    expect(expensesOfB[0]!.concept).toContain('secreta')
  })
})

describe('contexto de RLS', () => {
  it('las variables de contexto no se filtran entre peticiones', async () => {
    // El fallo más peligroso del diseño: si `set_config` se hiciera con `SET` en
    // vez de `SET LOCAL`, el valor se queda pegado a la conexión del pool y la
    // petición siguiente hereda el contexto de la anterior. Con un pool de
    // varias conexiones no se reproduce siempre, y en cada test con conexión
    // propia tampoco. Esta comprobación encadena dos transacciones sobre el
    // pool para provocarlo.
    const userA = await makeUser()
    const userB = await makeUser()
    const communityA = await community('Comunidad Contexto A')
    const communityB = await community('Comunidad Contexto B')

    await makeMember(userA.id, communityA)
    await makeMember(userB.id, communityB)

    await makeIncident(communityA, userA.id, { title: 'Incidencia de A' })

    // Diez iteraciones: el pool reparte las conexiones y, si el contexto se
    // pegara, alguna iteración leería la de A mientras se supone que está en B.
    for (let i = 0; i < 10; i++) {
      const asA = await withContext({ userId: userA.id, communityId: communityA }, (tx) =>
        tx.incidents.count({ where: { community_id: communityA } }),
      )
      expect(asA).toBe(1)

      const asB = await withContext({ userId: userB.id, communityId: communityB }, (tx) =>
        tx.incidents.count({ where: { community_id: communityA } }),
      )
      expect(asB).toBe(0)
    }
  })

  it('whoami lee el contexto desde la propia base de datos', async () => {
    const { whoami } = await import('../context.js')
    const rows = await whoami()

    // whoami pasa un UUID que no existe, así que ambos contextos deben salir
    // como los que se le pasaron y el rol debe ser NULL.
    expect(rows[0]!.user_id).toBe('00000000-0000-0000-0000-000000000000')
    expect(rows[0]!.role).toBeNull()
  })
})
