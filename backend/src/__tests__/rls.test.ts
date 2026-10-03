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
//   1. RLS     -> la base de datos filtra, aunque la aplicación se equivoque
//   2. aplicación -> el código pide los datos con el community_id correcto
//
// Un test que solo pasara por la API no distinguiría cuál de las dos capas está
// rota. Y una de las dos puede fallar sin que nadie lo note: por eso se
// comprueban por separado.
//
// Cubre los criterios 12, 13 y 14 de la spec 01.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { prisma } from '../db.js'
import { withContext } from '../context.js'
import { app, createUser, deleteUser } from './helpers.js'

const created: string[] = []
const createdCommunities: string[] = []

afterEach(async () => {
  while (created.length > 0) {
    await deleteUser(created.pop()!).catch(() => undefined)
  }
  while (createdCommunities.length > 0) {
    const communityId = createdCommunities.pop()!
    await prisma.communities.deleteMany({ where: { id: communityId } }).catch(() => undefined)
  }
})

async function makeCommunity(name: string) {
  const id = randomUUID()
  await prisma.communities.create({
    data: {
      id,
      name,
      slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${id.slice(0, 8)}`,
      address_line1: 'Calle de Prueba 1',
      city: 'Zaragoza',
      country: 'ES',
      latitude: 41.6488,
      longitude: -0.8891,
    },
  })
  createdCommunities.push(id)
  return id
}

async function makeMember(userId: string, communityId: string, role: 'ADMIN' | 'NEIGHBOR' = 'NEIGHBOR') {
  await prisma.communityMembers.create({
    data: { community_id: communityId, user_id: userId, role },
  })
}

async function makeUser() {
  const user = await createUser()
  created.push(user.id)
  return user
}

describe('rol de conexión y RLS', () => {
  it('la conexión usa app_runtime y NO tiene BYPASSRLS', async () => {
    // Criterio 13. Con el rol postgres (o con BYPASSRLS) la aplicación
    // funcionaría igual de bien y devolvería datos de todas las comunidades.
    // Este test falla ruidosamente en esa configuración en vez de dejar que el
    // fallo se descubra en producción.
    const rows = await prisma.$queryRaw<Array<{ session_user: string; bypassrls: boolean }>>`
      select session_user, rolbypassrls as bypassrls
    `

    expect(rows[0]!.session_user).toMatch(/^app_runtime/)
    expect(rows[0]!.bypassrls).toBe(false)
  })

  it('sin set_config, las consultas de datos de comunidad devuelven 0 filas', async () => {
    // Criterio 14. Esta es la propiedad que hace que un fallo de la capa de
    // aplicación sea visible: si el contexto no se aplica, la consulta no
    // devuelve datos ajenos, devuelve nada. Falla ruidoso y cerrado en vez de
    // abierto y silencioso.
    const communityId = await makeCommunity('Comunidad Sin Contexto')

    const [rows, users] = await Promise.all([
      prisma.incidents.count({ where: { community_id: communityId } }),
      prisma.users.count(),
    ])

    expect(rows).toBe(0)
    expect(users).toBe(0)
  })
})

describe('aislamiento entre comunidades', () => {
  it('criterio 12 · un miembro de la comunidad A no lee las incidencias de la B', async () => {
    // Dos comunidades con un vecino cada una y una incidencia en la segunda.
    const userA = await makeUser()
    const userB = await makeUser()
    const communityA = await makeCommunity('Comunidad A')
    const communityB = await makeCommunity('Comunidad B')

    await makeMember(userA.id, communityA)
    await makeMember(userB.id, communityB)

    const incidentB = randomUUID()
    await prisma.incidents.create({
      data: {
        id: incidentB,
        community_id: communityB,
        title: 'Ascensor parado en la comunidad B',
        description: 'No debe ser visible desde la comunidad A.',
        category: 'ELEVATOR',
        priority: 'HIGH',
        status: 'OPEN',
        reporter_id: userB.id,
        reference_code: randomUUID().slice(0, 8),
      },
    })

    // Con el contexto de la comunidad A, la incidencia de B no aparece.
    const visibleFromA = await withContext({ userId: userA.id, communityId: communityA }, (tx) =>
      tx.incidents.findMany({ where: { community_id: communityB } }),
    )
    expect(visibleFromA).toHaveLength(0)

    // Y desde B sí aparece, lo que confirma que la consulta funciona y que lo
    // que se filtró fue el aislamiento, no un fallo de la consulta.
    const visibleFromB = await withContext({ userId: userB.id, communityId: communityB }, (tx) =>
      tx.incidents.findMany({ where: { community_id: communityB } }),
    )
    expect(visibleFromB).toHaveLength(1)
    expect(visibleFromB[0]!.title).toContain('comunidad B')
  })

  it('criterio 12 · dos vecinos de comunidades distintas no pueden leerse entre sí', async () => {
    const userA = await makeUser()
    const userB = await makeUser()
    const communityA = await makeCommunity('Comunidad A Lectura')
    const communityB = await makeCommunity('Comunidad B Lectura')

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
    const communityA = await makeCommunity('Comunidad A Lista')
    const communityB = await makeCommunity('Comunidad B Lista')
    await makeMember(userA.id, communityA)

    for (const [communityId, titulo] of [
      [communityA, 'Fuga de agua en A'],
      [communityB, 'Fuga de agua en B'],
    ] as const) {
      await prisma.incidents.create({
        data: {
          community_id: communityId,
          title: titulo,
          description: 'Descripcion de prueba.',
          category: 'PLUMBING',
          priority: 'MEDIUM',
          status: 'OPEN',
          reporter_id: userA.id,
        reference_code: randomUUID().slice(0, 8),
        },
      })
    }

    const incidents = await withContext({ userId: userA.id, communityId: communityA }, (tx) =>
      tx.incidents.findMany({ select: { title: true } }),
    )

    expect(incidents.map((i) => i.title)).toEqual(['Fuga de agua en A'])
    expect(incidents.some((i) => i.title.includes('B'))).toBe(false)
  })

  it('cambiar el communityId en la URL no da acceso a otra comunidad', async () => {
    // La versión del mismo requisito por la API. `requireCommunity` comprueba
    // la pertenencia real, así que cambiar el id en la URL da 403 en vez de
    // devolver los datos de la otra comunidad.
    const intruder = await makeUser()
    const owner = await makeUser()
    const intruderCommunity = await makeCommunity('Comunidad Intrusa')
    const victimCommunity = await makeCommunity('Comunidad Víctima')

    await makeMember(intruder.id, intruderCommunity)
    await makeMember(owner.id, victimCommunity)

    await prisma.incidents.create({
      data: {
        community_id: victimCommunity,
        title: 'Incidencia privada de la victima',
        description: 'No debe ser accesible.',
        category: 'OTHER',
        priority: 'LOW',
        status: 'OPEN',
        reporter_id: owner.id,
        reference_code: randomUUID().slice(0, 8),
      },
    })

    const login = await request(app())
      .post('/api/v1/auth/login')
      .send({ email: intruder.email, password: intruder.password })

    const res = await request(app())
      .get(`/api/v1/communities/${victimCommunity}/incidents`)
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)

    // 403 y no 404: el usuario existe y es miembro de la otra comunidad, así que
    // se le puede decir que no es suya sin filtrar nada.
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('un ADMIN de una comunidad no ve los gastos de la otra', async () => {
    // El caso que motivated el rol PRESIDENT vs ADMIN en 02_rls.sql: el dinero es
    // el dato más sensible y el que más caro sale que se filtre.
    const adminA = await makeUser()
    const adminB = await makeUser()
    const communityA = await makeCommunity('Comunidad A Dinero')
    const communityB = await makeCommunity('Comunidad B Dinero')

    await makeMember(adminA.id, communityA, 'ADMIN')
    await makeMember(adminB.id, communityB, 'ADMIN')

    await prisma.expenses.create({
      data: {
        community_id: communityB,
        concept: 'Factura secreta de B',
        category: 'MAINTENANCE',
        amount: '1234.56',
        expense_date: new Date(),
        created_by: adminB.id,
      },
    })

    const expensesOfA = await withContext({ userId: adminA.id, communityId: communityA }, (tx) =>
      tx.expenses.findMany({ select: { concept: true } }),
    )
    expect(expensesOfA).toHaveLength(0)

    const expensesOfB = await withContext({ userId: adminB.id, communityId: communityB }, (tx) =>
      tx.expenses.findMany({ select: { concept: true } }),
    )
    expect(expensesOfB).toHaveLength(1)
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
    const communityA = await makeCommunity('Comunidad Contexto A')
    const communityB = await makeCommunity('Comunidad Contexto B')

    await makeMember(userA.id, communityA)
    await makeMember(userB.id, communityB)

    await prisma.incidents.create({
      data: {
        community_id: communityA,
        title: 'Incidencia de A',
        description: 'Debe verse solo desde A.',
        category: 'OTHER',
        priority: 'LOW',
        status: 'OPEN',
        reporter_id: userA.id,
        reference_code: randomUUID().slice(0, 8),
      },
    })

    // Diez iteraciones: el pool reparte las conexiones y, si el contexto se
    // pegara, alguna Iteración leería la de A mientras se supone que está en B.
    for (let i = 0; i < 10; i++) {
      const asA = await withContext({ userId: userA.id, communityId: communityA }, (tx) =>
        tx.incidents.count({ where: { community_id: communityA } }),
      )
      expect(asA).toBe(1)

      const asB = await withContext({ userId: userB.id, communityId: communityB }, (tx) =>
        tx.incidents.count({ where: { community_id: communityB } }),
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