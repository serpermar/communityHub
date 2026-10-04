// ---------------------------------------------------------------------------
// Endpoints de comunidades, contra la base de datos real.
//
// No hay mocks. Lo que se comprueba aqui incluye cosas que un mock no puede
// comprobar: que la politica `communities_select_member` filtra de verdad, que
// `app_create_community()` crea al primer ADMIN dentro de la misma transaccion,
// y que un `ADMIN` de una comunidad no toca otra.
//
// El test central del proyecto esta en "aislamiento entre comunidades": un
// vecino de A que pide la comunidad B recibe 403 y no recibe NINGUN dato de B,
// ni por el cuerpo, ni por la cabecera Location, ni por el status.
//
// Cubre los criterios de aceptacion de la seccion 9 de la spec 02.
// ---------------------------------------------------------------------------

import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { admin } from '../db-admin.js'
import { withContext } from '../context.js'
import {
  app,
  createUser,
  deleteCommunity,
  deleteUser,
  makeAdminSa,
  makeCommunity,
  makeMember,
  uniqueEmail,
  type TestUser,
} from './helpers.js'

const RUTAS = '/api/v1/communities'

const usuarios: string[] = []
const comunidades: string[] = []

async function nuevoUsuario(): Promise<TestUser> {
  const user = await createUser()
  usuarios.push(user.id)
  return user
}

/** Crea el usuario, entra y devuelve su cabecera de autorizacion. */
async function tokenDe(user: { email: string; password: string }): Promise<string> {
  const res = await request(app()).post('/api/v1/auth/login').send({ email: user.email, password: user.password })
  expect(res.status).toBe(200)
  return `Bearer ${res.body.data.accessToken}`
}

/**
 * Un slug distinto por llamada.
 *
 * El indice es unico y los tests comparten la base de datos de la suite, asi que
 * dos tests con el mismo slug se pisarian. El contador local a este archivo
 * tambien vale si los tests llegaran a correr en paralelo.
 */
let contador = 0
function slugUnico(prefijo = 'com'): string {
  contador += 1
  return `${prefijo}-${Date.now().toString(36)}-${contador}`
}

/** Alta minima que valida. */
function cuerpoAlta(extra: Record<string, unknown> = {}) {
  return {
    name: `Comunidad ${contador}`,
    slug: slugUnico(),
    addressLine1: 'Calle Mayor 1',
    city: 'Valencia',
    ...extra,
  }
}

afterEach(async () => {
  // Se limpia en vez de dejar datos: la suite se puede reejecutar contra la misma
  // base, y un fallo a mitad no envenena los siguientes.
  while (comunidades.length > 0) {
    const id = comunidades.pop()!
    await deleteCommunity(id).catch(() => undefined)
  }
  while (usuarios.length > 0) {
    const id = usuarios.pop()!
    await deleteUser(id).catch(() => undefined)
  }
})

// ---------------------------------------------------------------------------
// POST: permiso de plataforma
// ---------------------------------------------------------------------------

describe('POST /api/v1/communities', () => {
  it('un NEIGHBOR recibe 403 y no crea nada', async () => {
    const vecino = await nuevoUsuario()
    const token = await tokenDe(vecino)

    const antes = await admin.communities.count()
    const res = await request(app()).post(RUTAS).set('Authorization', token).send(cuerpoAlta())

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    // El 403 solo vale si de verdad no se ha creado nada. Comprobar solo el
    // status daria por bueno un 403 que llegara despues de escribir.
    expect(await admin.communities.count()).toBe(antes)
  })

  it('sin token da 401', async () => {
    const res = await request(app()).post(RUTAS).send(cuerpoAlta())
    expect(res.status).toBe(401)
  })

  it('un ADMIN de una comunidad tambien recibe 403 (rol de plataforma, no de comunidad)', async () => {
    // El ADMIN de la comunidad A no puede crear comunidades. ADMIN y ADMIN_SA son
    // permisos distintos y confundirlos seria el fallo facil de este recurso.
    const adminA = await nuevoUsuario()
    const comunidadA = await makeCommunity('Comunidad A')
    comunidades.push(comunidadA)
    await makeMember(adminA.id, comunidadA, 'ADMIN')

    const token = await tokenDe(adminA)
    const res = await request(app()).post(RUTAS).set('Authorization', token).send(cuerpoAlta())

    expect(res.status).toBe(403)
  })

  it('un ADMIN_SA crea la comunidad y ya es ADMIN de ella, sin segundo paso', async () => {
    const staff = await makeAdminSa({ email: uniqueEmail('staff') })
    usuarios.push(staff.id)
    const token = await tokenDe(staff)

    const res = await request(app()).post(RUTAS).set('Authorization', token).send(cuerpoAlta())

    expect(res.status).toBe(201)
    expect(res.headers.location).toMatch(/^\/api\/v1\/communities\/[0-9a-f-]{36}$/)
    expect(res.body.data).toMatchObject({
      memberRole: 'ADMIN',
      country: 'ES',
      timezone: 'Europe/Madrid',
      latitude: null,
      longitude: null,
    })

    const id = res.body.data.id
    comunidades.push(id)

    // Lo importante: existe la membresia. Sin esta comprobacion, un 201 con
    // `memberRole: 'ADMIN'` hardcodeado pasaria aunque no hubiera nadie.
    const miembros = await admin.communityMembers.findMany({ where: { community_id: id } })
    expect(miembros).toHaveLength(1)
    expect(miembros[0]).toMatchObject({ user_id: staff.id, role: 'ADMIN', status: 'ACTIVE' })
    expect(miembros[0]!.joined_at).not.toBeNull()

    // Y el que se creo es el mismo actor.
    const fila = await admin.communities.findUniqueOrThrow({ where: { id }, select: { created_by: true } })
    expect(fila.created_by).toBe(staff.id)
  })

  it('el ADMIN_SA que crea una comunidad es su ADMIN y por tanto puede verla', async () => {
    const staff = await makeAdminSa({ email: uniqueEmail('staff') })
    usuarios.push(staff.id)
    const token = await tokenDe(staff)

    const creada = await request(app()).post(RUTAS).set('Authorization', token).send(cuerpoAlta())
    const id = creada.body.data.id
    comunidades.push(id)

    // El staff entra por requireCommunity como cualquier miembro. Si esto fallara
    // por el rol global, la creacion habria dejado una comunidad huerfana.
    const res = await request(app()).get(`${RUTAS}/${id}`).set('Authorization', token)
    expect(res.status).toBe(200)
    expect(res.body.data.memberRole).toBe('ADMIN')
  })

  it('el ADMIN_SA sin membresia recibe 403 al pedir la comunidad de otro (C-12)', async () => {
    // El staff de plataforma CREA comunidades pero no las LEE. Este es el limite
    // que hace que el permiso sea pequeño de verdad.
    const staff = await makeAdminSa({ email: uniqueEmail('staff') })
    usuarios.push(staff.id)
    const token = await tokenDe(staff)

    const comunidadAjena = await makeCommunity('Ajena')
    comunidades.push(comunidadAjena)

    const res = await request(app()).get(`${RUTAS}/${comunidadAjena}`).set('Authorization', token)
    expect(res.status).toBe(403)
  })

  it('un slug repetido da 409', async () => {
    const staff = await makeAdminSa({ email: uniqueEmail('staff') })
    usuarios.push(staff.id)
    const token = await tokenDe(staff)

    const cuerpo = cuerpoAlta()
    const primera = await request(app()).post(RUTAS).set('Authorization', token).send(cuerpo)
    expect(primera.status).toBe(201)
    comunidades.push(primera.body.data.id)

    const segunda = await request(app()).post(RUTAS).set('Authorization', token).send(cuerpo)
    expect(segunda.status).toBe(409)

    // El rechazo no dejo una comunidad a medias. La segunda llamada fallo dentro
    // de la transaccion, asi que no puede haber ni una fila con ese slug ni un
    // miembro sin dueño.
    expect(await admin.communities.count({ where: { slug: cuerpo.slug } })).toBe(1)
    // El staff sigue con una sola membresia ADMIN: la de la primera comunidad. Si
    // la segunda hubiera inserciones a medias, serían dos.
    const membresias = await admin.communityMembers.count({ where: { user_id: staff.id, role: 'ADMIN' } })
    expect(membresias).toBe(1)
  })

  it('rechaza un cuerpo invalido con 400 y el campo concreto', async () => {
    const staff = await makeAdminSa({ email: uniqueEmail('staff') })
    usuarios.push(staff.id)
    const token = await tokenDe(staff)

    const res = await request(app())
      .post(RUTAS)
      .set('Authorization', token)
      .send({ ...cuerpoAlta(), latitude: 39.474 }) // sin longitude

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details.some((d: { field: string }) => d.field.includes('latitude'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// El test central: aislamiento entre comunidades
// ---------------------------------------------------------------------------

describe('aislamiento entre comunidades', () => {
  it('un vecino de A que pide la comunidad B recibe 403 y ningun dato de B', async () => {
    const vecino = await nuevoUsuario()

    const comunidadA = await makeCommunity('Comunidad A')
    const comunidadB = await makeCommunity('Comunidad B')
    comunidades.push(comunidadA, comunidadB)
    await makeMember(vecino.id, comunidadA, 'NEIGHBOR')

    const token = await tokenDe(vecino)
    const res = await request(app()).get(`${RUTAS}/${comunidadB}`).set('Authorization', token)

    expect(res.status).toBe(403)
    // Ni un byte del recurso ajeno: ni el nombre, ni la ciudad, ni el slug. Un
    // 403 con el nombre en el cuerpo seria un 403 decorativo.
    expect(JSON.stringify(res.body)).not.toContain('Comunidad B')
    expect(res.body.data).toBeUndefined()
  })

  it('a nivel de base de datos, la politica tampoco devuelve la fila ajena', async () => {
    // La misma comprobacion sin HTTP. Si el filtro estuviera solo en la
    // aplicacion, este test lo veria y el anterior pasaria igual.
    const vecino = await nuevoUsuario()
    const comunidadB = await makeCommunity('Comunidad B Secreta')
    comunidades.push(comunidadB)
    await makeMember(vecino.id, comunidadB, 'ADMIN')

    // ADMIN de B, asi que tiene que verla.
    const dentro = await withContext({ userId: vecino.id, communityId: comunidadB }, (tx) =>
      tx.$queryRawUnsafe<Array<{ n: number }>>('select count(*)::int as n from communities where id = $1::uuid', comunidadB),
    )
    expect(dentro[0]!.n).toBe(1)

    // Y un ADMIN de A no.
    const otroVecino = await nuevoUsuario()
    const comunidadA = await makeCommunity('Comunidad A')
    comunidades.push(comunidadA)
    await makeMember(otroVecino.id, comunidadA, 'ADMIN')

    const fuera = await withContext({ userId: otroVecino.id, communityId: comunidadA }, (tx) =>
      tx.$queryRawUnsafe<Array<{ n: number }>>('select count(*)::int as n from communities where id = $1::uuid', comunidadB),
    )
    // Cero filas y NO un error: con SELECT, RLS filtra en silencio. Por eso la
    // afirmacion es sobre el contenido y no sobre que no reviente.
    expect(fuera[0]!.n).toBe(0)
  })

  it('un ADMIN de A no puede editar la comunidad B', async () => {
    const adminA = await nuevoUsuario()
    const comunidadA = await makeCommunity('Comunidad A')
    const comunidadB = await makeCommunity('Comunidad B')
    comunidades.push(comunidadA, comunidadB)
    await makeMember(adminA.id, comunidadA, 'ADMIN')

    const token = await tokenDe(adminA)
    const res = await request(app())
      .patch(`${RUTAS}/${comunidadB}`)
      .set('Authorization', token)
      .send({ name: 'Secuestrada' })

    expect(res.status).toBe(403)

    // Y la fila sigue intacta. Sin esto, un 403 por el motivo equivocado tambien
    // dejaria el nombre intacto y el test pasaria.
    const fila = await admin.communities.findUniqueOrThrow({ where: { id: comunidadB }, select: { name: true } })
    expect(fila.name).toBe('Comunidad B')
  })

  it('un miembro suspendido recibe 403', async () => {
    const vecino = await nuevoUsuario()
    const comunidadA = await makeCommunity('Comunidad A')
    comunidades.push(comunidadA)
    await makeMember(vecino.id, comunidadA, 'NEIGHBOR')
    await admin.communityMembers.updateMany({
      where: { user_id: vecino.id, community_id: comunidadA },
      data: { status: 'SUSPENDED' },
    })

    const token = await tokenDe(vecino)
    const res = await request(app()).get(`${RUTAS}/${comunidadA}`).set('Authorization', token)
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// Listado
// ---------------------------------------------------------------------------

describe('GET /api/v1/communities', () => {
  it('devuelve solo las comunidades del usuario, con su rol', async () => {
    const vecino = await nuevoUsuario()
    const a = await makeCommunity('Alfa')
    const b = await makeCommunity('Beta')
    const ajena = await makeCommunity('Gamma')
    comunidades.push(a, b, ajena)
    await makeMember(vecino.id, a, 'PRESIDENT')
    await makeMember(vecino.id, b, 'NEIGHBOR')

    const token = await tokenDe(vecino)
    const res = await request(app()).get(RUTAS).set('Authorization', token)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(2)
    // Ni una fila de la ajena, ni un nombre suyo filtrado.
    expect(JSON.stringify(res.body)).not.toContain('Gamma')

    const roles = Object.fromEntries(res.body.data.map((c: { id: string; memberRole: string }) => [c.id, c.memberRole]))
    expect(roles[a]).toBe('PRESIDENT')
    expect(roles[b]).toBe('NEIGHBOR')
  })

  it('no incluye las comunidades dadas de baja ni las borradas (C-5)', async () => {
    const vecino = await nuevoUsuario()
    const activa = await makeCommunity('Activa')
    const baja = await makeCommunity('Baja logica')
    const borrada = await makeCommunity('Borrada')
    comunidades.push(activa, baja, borrada)
    await makeMember(vecino.id, activa, 'NEIGHBOR')
    await makeMember(vecino.id, baja, 'NEIGHBOR')
    await makeMember(vecino.id, borrada, 'NEIGHBOR')

    await admin.communities.update({ where: { id: baja }, data: { is_active: false } })
    await admin.communities.update({ where: { id: borrada }, data: { deleted_at: new Date() } })

    const token = await tokenDe(vecino)
    const res = await request(app()).get(RUTAS).set('Authorization', token)

    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].id).toBe(activa)
  })

  it('sin token da 401', async () => {
    const res = await request(app()).get(RUTAS)
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Detalle
// ---------------------------------------------------------------------------

describe('GET /api/v1/communities/:communityId', () => {
  it('devuelve la comunidad con el envelope', async () => {
    const vecino = await nuevoUsuario()
    const id = await makeCommunity('Suya')
    comunidades.push(id)
    await makeMember(vecino.id, id, 'ADMIN')

    const token = await tokenDe(vecino)
    const res = await request(app()).get(`${RUTAS}/${id}`).set('Authorization', token)

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      id,
      name: 'Suya',
      memberRole: 'ADMIN',
      isActive: true,
    })
  })

  it('un UUID mal formado da 400 y no 403 (C-9)', async () => {
    const vecino = await nuevoUsuario()
    const token = await tokenDe(vecino)

    // 403 diria "no tienes permiso", que es una afirmacion falsa: el problema es
    // que el identificador no es un identificador.
    for (const malo of ['no-es-un-uuid', '123', 'abc-def', '1234-5678']) {
      const res = await request(app()).get(`${RUTAS}/${malo}`).set('Authorization', token)
      expect(res.status, `con id ${JSON.stringify(malo)}`).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('un id bien formado pero de otra persona da 403, no 404 (C-8)', async () => {
    // 404 confirmaria que ese id no existe, que es informacion sobre los ids ajenos.
    const a = await nuevoUsuario()
    const b = await nuevoUsuario()
    const comunidadB = await makeCommunity('De B')
    comunidades.push(comunidadB)
    await makeMember(b.id, comunidadB, 'NEIGHBOR')

    const tokenDeA = await tokenDe(a)
    const res = await request(app()).get(`${RUTAS}/${comunidadB}`).set('Authorization', tokenDeA)

    expect(res.status).toBe(403)
  })

  it('un id que no existe da 403, no 404', async () => {
    const vecino = await nuevoUsuario()
    const token = await tokenDe(vecino)

    const res = await request(app()).get(`${RUTAS}/${'99999999-9999-4999-8999-999999999999'}`).set('Authorization', token)
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

describe('PATCH /api/v1/communities/:communityId', () => {
  it('el ADMIN cambia la configuracion', async () => {
    const adminC = await nuevoUsuario()
    const id = await makeCommunity('Original')
    comunidades.push(id)
    await makeMember(adminC.id, id, 'ADMIN')

    const token = await tokenDe(adminC)
    const res = await request(app())
      .patch(`${RUTAS}/${id}`)
      .set('Authorization', token)
      .send({ name: 'Renombrada', city: 'Zaragoza' })

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ name: 'Renombrada', city: 'Zaragoza', memberRole: 'ADMIN' })
  })

  it('un PATCH parcial no toca los campos que no vienen', async () => {
    // El fallo que hizo aparecer `optionalText`: un `.transform()` en un campo
    // opcional hace que zod 4 lo rellene con null, y un simple renombrado borraba
    // la descripcion y el codigo postal.
    const adminC = await nuevoUsuario()
    const id = await makeCommunity('Con datos')
    comunidades.push(id)
    await makeMember(adminC.id, id, 'ADMIN')
    await admin.communities.update({
      where: { id },
      data: { description: 'Una descripcion que debe sobrevivir', postal_code: '46001', province: 'Valencia' },
    })

    const token = await tokenDe(adminC)
    const res = await request(app()).patch(`${RUTAS}/${id}`).set('Authorization', token).send({ name: 'Solo el nombre' })

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({
      name: 'Solo el nombre',
      description: 'Una descripcion que debe sobrevivir',
      postalCode: '46001',
      province: 'Valencia',
    })
  })

  it('un NEIGHBOR recibe 403 y no se pierde nada', async () => {
    const vecino = await nuevoUsuario()
    const id = await makeCommunity('Intacta')
    comunidades.push(id)
    await makeMember(vecino.id, id, 'NEIGHBOR')

    const token = await tokenDe(vecino)
    const res = await request(app()).patch(`${RUTAS}/${id}`).set('Authorization', token).send({ name: 'Cambiada' })

    // Y NO un 404: la politica habria afectado a cero filas y Prisma habria
    // lanzado P2025, que el middleware traduce a 404. El chequeo de rol va antes
    // justamente para que el codigo de error signifique algo.
    expect(res.status).toBe(403)
    const fila = await admin.communities.findUniqueOrThrow({ where: { id }, select: { name: true } })
    expect(fila.name).toBe('Intacta')
  })

  it('un PRESIDENT sin ser ADMIN recibe 403', async () => {
    const presidente = await nuevoUsuario()
    const id = await makeCommunity('Con presidente')
    comunidades.push(id)
    await makeMember(presidente.id, id, 'PRESIDENT')

    const token = await tokenDe(presidente)
    const res = await request(app()).patch(`${RUTAS}/${id}`).set('Authorization', token).send({ name: 'Cambiada' })
    expect(res.status).toBe(403)
  })

  it('rechaza cambiar el slug con 400 (C-6)', async () => {
    const adminC = await nuevoUsuario()
    const id = await makeCommunity('Slug fijo')
    comunidades.push(id)
    await makeMember(adminC.id, id, 'ADMIN')

    // Se lee ANTES de intentarlo: el helper anade un sufijo unico al slug, asi que
    // no se puede comparar con un literal.
    const slugAntes = (await admin.communities.findUniqueOrThrow({ where: { id }, select: { slug: true } })).slug

    const token = await tokenDe(adminC)
    const res = await request(app()).patch(`${RUTAS}/${id}`).set('Authorization', token).send({ slug: 'otro-slug' })

    expect(res.status).toBe(400)
    // El mensaje tiene que explicar que es deliberado, no "clave desconocida".
    expect(JSON.stringify(res.body.error.details)).toContain('slug')

    const fila = await admin.communities.findUniqueOrThrow({ where: { id }, select: { slug: true } })
    expect(fila.slug).toBe(slugAntes)
  })

  it('rechaza media coordenada con 400', async () => {
    const adminC = await nuevoUsuario()
    const id = await makeCommunity('Geo')
    comunidades.push(id)
    await makeMember(adminC.id, id, 'ADMIN')

    const token = await tokenDe(adminC)
    const res = await request(app())
      .patch(`${RUTAS}/${id}`)
      .set('Authorization', token)
      .send({ latitude: 39.474 })

    expect(res.status).toBe(400)
  })

  it('rechaza un cuerpo vacio con 400', async () => {
    const adminC = await nuevoUsuario()
    const id = await makeCommunity('Vacia')
    comunidades.push(id)
    await makeMember(adminC.id, id, 'ADMIN')

    const token = await tokenDe(adminC)
    const res = await request(app()).patch(`${RUTAS}/${id}`).set('Authorization', token).send({})
    expect(res.status).toBe(400)
  })

  it('la baja logica es un PATCH con isActive false, y no hay DELETE', async () => {
    const adminC = await nuevoUsuario()
    const id = await makeCommunity('Para dar de baja')
    comunidades.push(id)
    await makeMember(adminC.id, id, 'ADMIN')

    const token = await tokenDe(adminC)
    const baja = await request(app()).patch(`${RUTAS}/${id}`).set('Authorization', token).send({ isActive: false })
    expect(baja.status).toBe(200)
    expect(baja.body.data.isActive).toBe(false)

    // La fila sigue existiendo: la baja es logica, no un borrado.
    const fila = await admin.communities.findUnique({ where: { id } })
    expect(fila).not.toBeNull()

    // Y no hay endpoint de borrado fisico.
    const borrado = await request(app()).delete(`${RUTAS}/${id}`).set('Authorization', token)
    expect(borrado.status).toBe(404)
    expect(await admin.communities.findUnique({ where: { id } })).not.toBeNull()
  })

  it('la comunidad dada de baja desaparece del listado pero sigue consultable por id', async () => {
    const adminC = await nuevoUsuario()
    const id = await makeCommunity('Baja')
    comunidades.push(id)
    await makeMember(adminC.id, id, 'ADMIN')

    const token = await tokenDe(adminC)
    await request(app()).patch(`${RUTAS}/${id}`).set('Authorization', token).send({ isActive: false })

    const listado = await request(app()).get(RUTAS).set('Authorization', token)
    expect(listado.body.data.map((c: { id: string }) => c.id)).not.toContain(id)

    // Por id sigue saliendo, porque el filtro de `is_active` es solo del listado.
    // De lo contrario un ADMIN perderia la capacidad de volver a reactivarla.
    const detalle = await request(app()).get(`${RUTAS}/${id}`).set('Authorization', token)
    expect(detalle.status).toBe(200)
    expect(detalle.body.data.isActive).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Suelo de la base de datos
// ---------------------------------------------------------------------------

describe('invariantes de la base de datos', () => {
  it('un INSERT directo con app_runtime sin ser ADMIN_SA lo rechaza RLS', async () => {
    // El camino que la politica `communities_insert_admin_sa` cierra. Sin ella,
    // la proteccion dependeria solo de que nadie escriba este INSERT.
    const vecino = await nuevoUsuario()
    const slug = slugUnico('directo')

    await expect(
      withContext({ userId: vecino.id, communityId: null }, (tx) =>
        tx.$executeRawUnsafe(
          `insert into communities (name, slug, address_line1, city, created_by)
           values ('Hack', $1, 'Calle 1', 'Madrid', $2::uuid)`,
          slug,
          vecino.id,
        ),
      ),
    ).rejects.toThrow(/row-level security/i)

    expect(await admin.communities.count({ where: { slug } })).toBe(0)
  })

  it('la comunidad creada no se puede borrar en cascada desde el rol de la app', async () => {
    const staff = await makeAdminSa({ email: uniqueEmail('staff') })
    usuarios.push(staff.id)
    const token = await tokenDe(staff)

    const creada = await request(app()).post(RUTAS).set('Authorization', token).send(cuerpoAlta())
    const id = creada.body.data.id
    comunidades.push(id)

    // Ni siquiera el staff. Sin politica de DELETE, el DELETE afecta 0 filas y no
    // lanza: por eso se comprueba que la fila SIGA VIVA.
    const afectadas = await withContext({ userId: staff.id, communityId: null }, (tx) =>
      tx.$executeRawUnsafe('delete from communities where id = $1::uuid', id),
    )
    expect(afectadas).toBe(0)
    expect(await admin.communities.findUnique({ where: { id } })).not.toBeNull()
  })

  it('las coordenadas se guardan tal cual y salen como numero, no como texto', async () => {
    const staff = await makeAdminSa({ email: uniqueEmail('staff') })
    usuarios.push(staff.id)
    const token = await tokenDe(staff)

    const res = await request(app())
      .post(RUTAS)
      .set('Authorization', token)
      .send(cuerpoAlta({ latitude: 39.474, longitude: -0.379 }))

    const id = res.body.data.id
    comunidades.push(id)

    expect(typeof res.body.data.latitude).toBe('number')
    expect(res.body.data.latitude).toBeCloseTo(39.474, 5)
    expect(typeof res.body.data.longitude).toBe('number')
  })

  it('alta solo con direccion: 201 y latitude null (C-7)', async () => {
    const staff = await makeAdminSa({ email: uniqueEmail('staff') })
    usuarios.push(staff.id)
    const token = await tokenDe(staff)

    const res = await request(app()).post(RUTAS).set('Authorization', token).send(cuerpoAlta())

    expect(res.status).toBe(201)
    const id = res.body.data.id
    comunidades.push(id)

    // `null` y no `0,0`: el golfo de Guinea no es una ubicacion por defecto
    // aceptable, y el test falla si alguien lo rellena para evitar el nullable.
    expect(res.body.data.latitude).toBeNull()
    expect(res.body.data.longitude).toBeNull()
    // Lo que si tiene que venir es la direccion.
    expect(res.body.data.addressLine1).toBe('Calle Mayor 1')
    // Y los valores por defecto de la funcion.
    expect(res.body.data.country).toBe('ES')
    expect(res.body.data.timezone).toBe('Europe/Madrid')
  })

  it('app_create_community con un actor que no es ADMIN_SA falla con 42501 y no deja ni comunidad ni miembro', async () => {
    // El 42501 es `insufficient_privilege`: la guarda DENTRO de la funcion
    // rechaza. Es distinto del 403 de HTTP, que lo pone el middleware antes de
    // llegar aqui. Se comprueba la funcion directamente porque la garantia que
    // importa es que la exception vive en SQL y no solo en TypeScript.
    const vecino = await nuevoUsuario()
    const slug = slugUnico('sin-permiso')

    await expect(
      withContext({ userId: vecino.id, communityId: null }, (tx) =>
        tx.$queryRawUnsafe(
          `select app_create_community(
             'Sin permiso', $1, 'Calle 1', 'Madrid', null, null, null, null,
             null, null, null, null)`,
          slug,
        ),
      ),
    ).rejects.toThrow(/42501|insufficient_privilege|permission denied/i)

    // Ni la comunidad ni un miembro a medias.
    expect(await admin.communities.count({ where: { slug } })).toBe(0)
    expect(await admin.communityMembers.count({ where: { user_id: vecino.id } })).toBe(0)
  })

  it('public, anon y authenticated no pueden ejecutar app_create_community', async () => {
    // `SECURITY DEFINER` sin `revoke execute` a PUBLIC es una escalada
    // esperando a ocurrir: cualquier rol de Supabase podria crear comunidades sin
    // ser ADMIN_SA, porque la guarda de la propia funcion compara contra
    // `app_current_user_id()` y sin sesion eso es NULL.
    const filas = await admin.$queryRaw<Array<{ rol: string; puede: boolean }>>`
      select r.rolname as rol,
             has_function_privilege(r.oid, 'app_create_community(text,text,text,text,text,text,text,text,numeric,numeric,text,text)', 'execute') as puede
        from pg_roles r
       where r.rolname in ('public', 'anon', 'authenticated', 'app_runtime')
       order by r.rolname
    `

    const porRol = Object.fromEntries(filas.map((f) => [f.rol, f.puede]))
    expect(porRol.public ?? false).toBe(false)
    expect(porRol.anon ?? false).toBe(false)
    expect(porRol.authenticated ?? false).toBe(false)
    // El unico que puede es el rol de la aplicacion, y su unica puerta es la
    // guarda de ADMIN_SA.
    expect(porRol.app_runtime).toBe(true)
  })

  it('el slug se guarda en minusculas y se rechaza con mayusculas o espacios', async () => {
    const staff = await makeAdminSa({ email: uniqueEmail('staff') })
    usuarios.push(staff.id)
    const token = await tokenDe(staff)

    const malo = await request(app())
      .post(RUTAS)
      .set('Authorization', token)
      .send({ ...cuerpoAlta(), slug: 'Barrio Alto' })

    expect(malo.status).toBe(400)

    // Y el bueno se guarda tal cual, que es lo que hace el indice unico
    // sensible a mayusculas inutil.
    const bueno = slugUnico('minusculas').toLowerCase()
    const res = await request(app())
      .post(RUTAS)
      .set('Authorization', token)
      .send({ ...cuerpoAlta(), slug: bueno })

    expect(res.status).toBe(201)
    const id = res.body.data.id
    comunidades.push(id)

    const fila = await admin.communities.findUniqueOrThrow({ where: { id }, select: { slug: true } })
    expect(fila.slug).toBe(bueno)
    expect(fila.slug).toBe(fila.slug.toLowerCase())
  })

  it('force row level security sigue activo y no hay politica de DELETE', async () => {
    const filas = await admin.$queryRaw<Array<{ forzar: boolean; delete_policies: number }>>`
      select c.relforcerowsecurity as forzar,
             (select count(*)::int from pg_policies p
               where p.schemaname = 'public' and p.tablename = 'communities' and p.cmd = 'DELETE') as delete_policies
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'communities'
    `

    expect(filas[0]?.forzar).toBe(true)
    // Cero, no "una que no se usa": sin politica de DELETE, el rol de la app
    // afecta 0 filas, que es el comportamiento que se comprueba mas arriba.
    expect(filas[0]?.delete_policies).toBe(0)
  })
})
