// ---------------------------------------------------------------------------
// Avisos por API: seguridad, ventana por rol, alta, edicion, borrado y listado.
//
// Este es el archivo que demuestra que el bloque 07 hace lo que dice la spec.
// Los unitarios comprueban la FORMA de lo que entra; aqui lo que se comprueba
// es el COMPORTAMIENTO contra Postgres, y hay seis cosas que solo se pueden
// demostrar aqui:
//
//   - La ventana por rol (AN-4/AN-7): el mismo aviso programado o caducado que
//   - un NEIGHBOR no ve, un ADMIN de la misma comunidad si. Esa decision la
//     toma `app_list_announcements()` con `now()` de Postgres; reimplementarla
//     en TypeScript con el reloj del servidor seria una segunda verdad.
//   - La terna de rol completa: el guard HTTP del POST
//     (`requireCommunityRole('PRESIDENT','ADMIN')`) y la funcion SQL tienen que
//     dar el MISMO 403, y el DELETE no lleva guard —su 403 es de la funcion
//     (`announcement_requires_admin`) con la fila delante.
//   - AN-9, que el autor no se puede ni mandar ni reasignar: `authorId` en el
//     cuerpo es 400, y un PUT de otro president devuelve 200 con el autor
//     original.
//   - El soft delete (AN-5): la fila sigue existiendo con `deleted_at` puesto,
//     y sin embargo desaparece del listado para todos los roles. Eso no se puede
//     afirmar sin mirar la tabla con privilegio.
//   - La paginacion con su `meta`, incluido el caso feo de pedir una pagina mas
//     alla del final: `total` tiene que seguir siendo el real.
//   - El orden de AN-8, que es el del indice parcial: fijados primero y dentro
//     de cada grupo `publish_at` descendente.
//
// La regla de `helpers.ts` ("sembrar con privilegio, afirmar con restriccion")
// se cumple sin excepcion: los fixtures se crean con `admin` y todas las
// afirmaciones pasan por la API, es decir, por el rol de runtime con RLS. La
// unica lectura directa es la de `deleted_at` al final del borrado, y es a
// proposito: un 200 de la API no prueba que la fila siga viva.
//
// NOTA sobre los 404 de las rutas de aviso: `PUT /announcements/:id` y
// `DELETE /announcements/:id` no llevan comunidad en la URL, y
// `requireAnnouncement()` resuelve la comunidad del AVISO. Un id inexistente,
// el de otra comunidad o el de una comunidad a la que ya no perteneces son el
// mismo 404, y por el mismo motivo (C-8): un 403 confirmaria que ese id existe.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
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
 * herede.
 *
 * Ademas hace falta por una razon no negociable: el rate limit global son 300
 * peticiones cada 15 minutos por IP, y una instancia por test con cinco
 * logins cada uno pasaria de ese techo sin que ningun test este midiendo nada
 * interesante.
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

/** El staff de plataforma, sin membresia: 403 en rutas de comunidad (C-12). */
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
// Fechas y cuerpos
// ---------------------------------------------------------------------------

/** Instantes relativos a `now()`: la ventana se decide con el reloj de hoy. */
function enPasado(dias: number): string {
  return new Date(Date.now() - dias * 86_400_000).toISOString()
}

function enFuturo(dias: number): string {
  return new Date(Date.now() + dias * 86_400_000).toISOString()
}

/** El cuerpo minimo de un POST valido, con titulo unico por test. */
function altaValida(extra: Record<string, unknown> = {}) {
  return {
    title: `Aviso ${randomUUID().slice(0, 8)}`,
    body: 'Cuerpo de prueba del aviso, suficientemente largo para el minimo.',
    ...extra,
  }
}

/** El PUT completo que exige AN-6, partiendo de un aviso leido. */
function putValido(aviso: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    title: aviso.title,
    body: aviso.body,
    type: aviso.type,
    priority: aviso.priority,
    isPinned: aviso.isPinned,
    publishAt: aviso.publishAt,
    expiresAt: aviso.expiresAt,
    ...extra,
  }
}

type Aviso = {
  id: string
  communityId: string
  title: string
  body: string
  type: string
  priority: string
  isPinned: boolean
  publishAt: string
  expiresAt: string | null
  authorId: string | null
  authorName: string | null
  createdAt: string
  updatedAt: string
}

/** Crea un aviso por la API y devuelve el `data` de la respuesta. */
async function crear(token: string, comunidad: string, extra: Record<string, unknown> = {}): Promise<Aviso> {
  const res = await request(app())
    .post(`${V1}/communities/${comunidad}/announcements`)
    .set('Authorization', token)
    .send(altaValida(extra))
  expect(res.status, `creando: ${JSON.stringify(res.body)}`).toBe(201)
  return res.body.data
}

/** El listado, exigiendo 200 y devolviendo la respuesta entera (para `meta`). */
async function listar(token: string, comunidad: string, query = '') {
  const res = await request(app())
    .get(`${V1}/communities/${comunidad}/announcements${query}`)
    .set('Authorization', token)
  expect(res.status, `listando: ${JSON.stringify(res.body)}`).toBe(200)
  return res
}

/** Los ids del listado, en el orden en que llegan. */
function idsDe(res: { body: { data: Aviso[] } }): string[] {
  return res.body.data.map((a) => a.id)
}

// ---------------------------------------------------------------------------

describe('Seguridad y aislamiento entre comunidades', () => {
  it('sin token, las cuatro rutas son 401', async () => {
    const e = await escena()
    const aviso = await crear(e.admin.token, e.comunidad)

    const lista = await request(app()).get(`${V1}/communities/${e.comunidad}/announcements`)
    expect(lista.status).toBe(401)

    const alta = await request(app()).post(`${V1}/communities/${e.comunidad}/announcements`).send(altaValida())
    expect(alta.status).toBe(401)

    const put = await request(app()).put(`${V1}/announcements/${aviso.id}`).send(putValido(aviso))
    expect(put.status).toBe(401)

    const borrar = await request(app()).delete(`${V1}/announcements/${aviso.id}`)
    expect(borrar.status).toBe(401)
  })

  it('un no miembro: 403 en el listado, 404 en PUT y DELETE', async () => {
    const e = await escena()
    const ajeno = await outsider()
    const aviso = await crear(e.admin.token, e.comunidad)

    const lista = await request(app())
      .get(`${V1}/communities/${e.comunidad}/announcements`)
      .set('Authorization', ajeno.token)
    expect(lista.status).toBe(403)

    // Los dos de aviso resuelven la comunidad con `app_announcement_community()`,
    // que exige membresia activa: NULL y por tanto 404. Un 403 confirmaria que
    // ese id existe (C-8).
    const put = await request(app())
      .put(`${V1}/announcements/${aviso.id}`)
      .set('Authorization', ajeno.token)
      .send(putValido(aviso))
    expect(put.status).toBe(404)

    const borrar = await request(app())
      .delete(`${V1}/announcements/${aviso.id}`)
      .set('Authorization', ajeno.token)
    expect(borrar.status).toBe(404)
  })

  it('un miembro de A no lee ni gestiona avisos de B', async () => {
    const e = await escena()
    // La misma comunidad B para los dos papeles: el admin crea alli, el vecino
    // de A intenta.
    const comunidadB = await nuevaComunidad('Comunidad B')
    await makeMember(e.admin.id, comunidadB, 'ADMIN')
    const avisoDeB = await crear(e.admin.token, comunidadB)

    const lista = await request(app())
      .get(`${V1}/communities/${comunidadB}/announcements`)
      .set('Authorization', e.vecinoA.token)
    expect(lista.status).toBe(403)

    const put = await request(app())
      .put(`${V1}/announcements/${avisoDeB.id}`)
      .set('Authorization', e.vecinoA.token)
      .send(putValido(avisoDeB))
    expect(put.status).toBe(404)

    const borrar = await request(app())
      .delete(`${V1}/announcements/${avisoDeB.id}`)
      .set('Authorization', e.vecinoA.token)
    expect(borrar.status).toBe(404)
  })

  it('un ADMIN_SA que no es miembro: 403 en la comunidad, 404 en el aviso', async () => {
    const e = await escena()
    const elena = await adminSa()
    const aviso = await crear(e.admin.token, e.comunidad)

    const lista = await request(app())
      .get(`${V1}/communities/${e.comunidad}/announcements`)
      .set('Authorization', elena.token)
    expect(lista.status).toBe(403)

    const alta = await request(app())
      .post(`${V1}/communities/${e.comunidad}/announcements`)
      .set('Authorization', elena.token)
      .send(altaValida())
    expect(alta.status).toBe(403)

    const put = await request(app())
      .put(`${V1}/announcements/${aviso.id}`)
      .set('Authorization', elena.token)
      .send(putValido(aviso))
    expect(put.status).toBe(404)
  })

  it('un miembro suspendido: 403 en el listado y 404 en el PUT', async () => {
    const e = await escena()
    const aviso = await crear(e.admin.token, e.comunidad)

    const { admin } = await import('../db-admin.js')
    await admin.communityMembers.update({
      where: { community_id_user_id: { community_id: e.comunidad, user_id: e.vecinoB.id } },
      data: { status: 'SUSPENDED' },
    })

    const lista = await request(app())
      .get(`${V1}/communities/${e.comunidad}/announcements`)
      .set('Authorization', e.vecinoB.token)
    expect(lista.status).toBe(403)

    const put = await request(app())
      .put(`${V1}/announcements/${aviso.id}`)
      .set('Authorization', e.vecinoB.token)
      .send(putValido(aviso))
    expect(put.status).toBe(404)

    const borrar = await request(app())
      .delete(`${V1}/announcements/${aviso.id}`)
      .set('Authorization', e.vecinoB.token)
    expect(borrar.status).toBe(404)
  })

  it('un id de aviso o de comunidad que no es un UUID es 400', async () => {
    const e = await escena()

    const put = await request(app())
      .put(`${V1}/announcements/no-es-uuid`)
      .set('Authorization', e.admin.token)
      .send({})
    expect(put.status).toBe(400)
    expect(put.body.error.code).toBe('VALIDATION_ERROR')

    const borrar = await request(app())
      .delete(`${V1}/announcements/tampoco-es-uuid`)
      .set('Authorization', e.admin.token)
    expect(borrar.status).toBe(400)

    const lista = await request(app())
      .get(`${V1}/communities/no-es-uuid/announcements`)
      .set('Authorization', e.admin.token)
    expect(lista.status).toBe(400)
  })
})

describe('Ventana de visibilidad (AN-4, AN-7)', () => {
  it('el programado y el caducado solo los ven PRESIDENT y ADMIN', async () => {
    const e = await escena()

    const vivo = await crear(e.admin.token, e.comunidad, { publishAt: enPasado(1) })
    const caducado = await crear(e.admin.token, e.comunidad, {
      publishAt: enPasado(10),
      expiresAt: enPasado(2),
    })
    const programado = await crear(e.admin.token, e.comunidad, { publishAt: enFuturo(30) })

    // NEIGHBOR y PROVIDER: solo el vivo. El caducado y el programado no salen.
    for (const [nombre, actor_] of [
      ['NEIGHBOR', e.vecinoA],
      ['PROVIDER', e.proveedor],
    ] as const) {
      const res = await listar(actor_.token, e.comunidad)
      expect(res.body.data, `con rol ${nombre}`).toHaveLength(1)
      expect(idsDe(res), `con rol ${nombre}`).toEqual([vivo.id])
    }

    // PRESIDENT y ADMIN: los tres, con su publishAt real para que el cliente
    // marque el programado como tal.
    let vistaDeGestion: Aviso[] = []
    for (const [nombre, actor_] of [
      ['ADMIN', e.admin],
      ['PRESIDENT', e.presidente],
    ] as const) {
      const res = await listar(actor_.token, e.comunidad)
      expect(res.body.data, `con rol ${nombre}`).toHaveLength(3)
      const ids = idsDe(res)
      expect(ids, `con rol ${nombre}`).toContain(programado.id)
      expect(ids, `con rol ${nombre}`).toContain(caducado.id)
      if (nombre === 'ADMIN') vistaDeGestion = res.body.data
    }

    const programadoEnLaLista = vistaDeGestion.find((a) => a.id === programado.id)
    expect(programadoEnLaLista?.publishAt).toBe(programado.publishAt)
  })

  it('un aviso sin expiresAt nunca caduca', async () => {
    const e = await escena()
    const aviso = await crear(e.admin.token, e.comunidad, { publishAt: enPasado(365) })

    const res = await listar(e.vecinoA.token, e.comunidad)
    expect(idsDe(res)).toContain(aviso.id)
    expect(res.body.data[0].expiresAt).toBeNull()
  })

  it('expiresAt <= publishAt es 400 en el POST y en el PUT', async () => {
    const e = await escena()

    const enPost = await request(app())
      .post(`${V1}/communities/${e.comunidad}/announcements`)
      .set('Authorization', e.admin.token)
      .send(altaValida({ publishAt: enFuturo(2), expiresAt: enPasado(2) }))
    expect(enPost.status).toBe(400)
    expect(enPost.body.error.code).toBe('VALIDATION_ERROR')

    const aviso = await crear(e.admin.token, e.comunidad)
    const enPut = await request(app())
      .put(`${V1}/announcements/${aviso.id}`)
      .set('Authorization', e.admin.token)
      .send(putValido(aviso, { publishAt: enFuturo(2), expiresAt: enFuturo(2) }))
    expect(enPut.status).toBe(400)
  })
})

describe('Alta (AN-1, AN-9)', () => {
  it('un ADMIN y un PRESIDENT crean con los defaults de la funcion', async () => {
    const e = await escena()

    for (const [nombre, actor_, nombreCompleto] of [
      ['ADMIN', e.admin, 'Administradora'],
      ['PRESIDENT', e.presidente, 'Presidente'],
    ] as const) {
      const aviso = await crear(actor_.token, e.comunidad)

      expect(aviso.communityId, `con rol ${nombre}`).toBe(e.comunidad)
      expect(aviso.type, `con rol ${nombre}`).toBe('GENERAL')
      expect(aviso.priority, `con rol ${nombre}`).toBe('MEDIUM')
      expect(aviso.isPinned, `con rol ${nombre}`).toBe(false)
      expect(aviso.expiresAt, `con rol ${nombre}`).toBeNull()
      // AN-9: el autor sale de la sesion y `authorName` de la relectura (AN-3),
      // no del cuerpo.
      expect(aviso.authorId, `con rol ${nombre}`).toBe(actor_.id)
      expect(aviso.authorName, `con rol ${nombre}`).toBe(nombreCompleto)
      // Sin Location: no hay GET /announcements/:id (ARCHITECTURE.md §6).
    }
  })

  it('un NEIGHBOR o un PROVIDER reciben 403 y no escribe nada', async () => {
    const e = await escena()

    for (const [nombre, actor_] of [
      ['NEIGHBOR', e.vecinoA],
      ['PROVIDER', e.proveedor],
    ] as const) {
      const res = await request(app())
        .post(`${V1}/communities/${e.comunidad}/announcements`)
        .set('Authorization', actor_.token)
        .send(altaValida())

      expect(res.status, `con rol ${nombre}`).toBe(403)
      expect(res.body.error.code, `con rol ${nombre}`).toBe('FORBIDDEN')
    }

    // "La funcion no escribe nada": el listado sigue vacio.
    const res = await listar(e.admin.token, e.comunidad)
    expect(res.body.data).toHaveLength(0)
  })

  it('valida la forma antes de llegar a la base de datos', async () => {
    const e = await escena()

    const casos: Array<[string, Record<string, unknown>]> = [
      ['title de dos caracteres', { title: 'ab' }],
      ['body de 5001', { body: 'a'.repeat(5001) }],
      ['type inventado', { type: 'AVISO' }],
      ['authorId en el cuerpo (AN-9)', { authorId: e.admin.id }],
      ['communityId en el cuerpo', { communityId: e.comunidad }],
      ['isPinned que no es booleano', { isPinned: 'si' }],
      ['publishAt que no es instante', { publishAt: 'manana' }],
      ['cuerpo vacio', {}],
    ]

    for (const [nombre, cuerpo] of casos) {
      const res = await request(app())
        .post(`${V1}/communities/${e.comunidad}/announcements`)
        .set('Authorization', e.admin.token)
        .send(cuerpo)

      expect(res.status, `con ${nombre}`).toBe(400)
      expect(res.body.error.code, `con ${nombre}`).toBe('VALIDATION_ERROR')
    }
  })

  it('un titulo con texto de sentinel es un titulo normal, no un error', async () => {
    const e = await escena()

    // Un titulo que contiene el texto exacto de dos sentinels. Es un titulo
    // VALIDO, asi que lo correcto es un 201: con la traduccion por PAR, el
    // texto del cliente no puede convertirse en un 404.
    const aviso = await crear(e.admin.token, e.comunidad, {
      title: 'announcement_not_found forbidden_role',
    })

    expect(aviso.title).toBe('announcement_not_found forbidden_role')
  })
})

describe('Edicion (AN-6, AN-9)', () => {
  it('un PRESIDENT distinto del autor edita y el autor no cambia', async () => {
    const e = await escena()
    const aviso = await crear(e.admin.token, e.comunidad)

    const res = await request(app())
      .put(`${V1}/announcements/${aviso.id}`)
      .set('Authorization', e.presidente.token)
      .send(putValido(aviso, { title: 'Titulo reescrito por la presidencia' }))

    expect(res.status).toBe(200)
    expect(res.body.data.title).toBe('Titulo reescrito por la presidencia')
    // AN-9: el PUT no toca la autoria. La mentira historica de reasignar un
    // aviso es lo que este assert impide.
    expect(res.body.data.authorId).toBe(e.admin.id)
    expect(res.body.data.authorName).toBe('Administradora')
  })

  it('un NEIGHBOR o un PROVIDER reciben 403 de la FUNCION, no del guard', async () => {
    const e = await escena()
    const aviso = await crear(e.admin.token, e.comunidad)

    // La ruta de PUT no lleva requireCommunityRole: el rol lo decide
    // app_update_announcement() con la fila delante. Este test es la prueba de
    // que esa capa existe — si desapareciera, estos dos darian 200.
    for (const [nombre, actor_] of [
      ['NEIGHBOR', e.vecinoA],
      ['PROVIDER', e.proveedor],
    ] as const) {
      const res = await request(app())
        .put(`${V1}/announcements/${aviso.id}`)
        .set('Authorization', actor_.token)
        .send(putValido(aviso, { title: 'Intento ajeno' }))

      expect(res.status, `con rol ${nombre}`).toBe(403)
      expect(res.body.error.code, `con rol ${nombre}`).toBe('FORBIDDEN')
    }

    // Y el aviso sigue como estaba, no como el intento.
    const res = await listar(e.admin.token, e.comunidad)
    expect(res.body.data[0].title).not.toBe('Intento ajeno')
  })

  it('el PUT exige los ocho campos y rechaza los que no son del aviso', async () => {
    const e = await escena()
    const aviso = await crear(e.admin.token, e.comunidad)

    // Sin un campo obligatorio: reemplazo completo, no PATCH (AN-6).
    const { expiresAt: _sinCaducidad, ...incompleto } = putValido(aviso)
    const sinCampo = await request(app())
      .put(`${V1}/announcements/${aviso.id}`)
      .set('Authorization', e.admin.token)
      .send(incompleto)
    expect(sinCampo.status).toBe(400)

    // Los campos que no son del aviso: el id va en la URL, y autor, comunidad
    // y marca de tiempo los pone el servidor.
    for (const clave of ['id', 'authorId', 'communityId', 'createdAt', 'updatedAt'] as const) {
      const res = await request(app())
        .put(`${V1}/announcements/${aviso.id}`)
        .set('Authorization', e.admin.token)
        .send(putValido(aviso, { [clave]: 'lo-que-sea' }))

      expect(res.status, `con la clave ${clave}`).toBe(400)
      expect(res.body.error.code, `con la clave ${clave}`).toBe('VALIDATION_ERROR')
    }
  })

  it('un PUT que reprograma hacia el futuro saca el aviso del listado del vecino', async () => {
    const e = await escena()
    const aviso = await crear(e.admin.token, e.comunidad)

    const res = await request(app())
      .put(`${V1}/announcements/${aviso.id}`)
      .set('Authorization', e.admin.token)
      .send(putValido(aviso, { publishAt: enFuturo(45) }))

    expect(res.status).toBe(200)

    // Sin cambiar de estado, porque no lo hay (AN-4): el aviso pasa a estar
    // programado y la ventana lo esconde del NEIGHBOR.
    const delVecino = await listar(e.vecinoA.token, e.comunidad)
    expect(idsDe(delVecino)).not.toContain(aviso.id)

    const delAdmin = await listar(e.admin.token, e.comunidad)
    expect(idsDe(delAdmin)).toContain(aviso.id)
  })

  it('el PUT puede dejar de caducar (expiresAt null)', async () => {
    const e = await escena()
    const caducado = await crear(e.admin.token, e.comunidad, {
      publishAt: enPasado(10),
      expiresAt: enPasado(2),
    })

    const res = await request(app())
      .put(`${V1}/announcements/${caducado.id}`)
      .set('Authorization', e.admin.token)
      .send(putValido(caducado, { expiresAt: null }))

    expect(res.status).toBe(200)
    expect(res.body.data.expiresAt).toBeNull()

    // Y vuelve a estar vivo para todo el mundo.
    const delVecino = await listar(e.vecinoA.token, e.comunidad)
    expect(idsDe(delVecino)).toContain(caducado.id)
  })
})

describe('Borrado (AN-5, AN-11)', () => {
  it('el PRESIDENT no borra: 403 con mensaje propio y la fila sigue viva', async () => {
    const e = await escena()
    const aviso = await crear(e.admin.token, e.comunidad)

    const res = await request(app())
      .delete(`${V1}/announcements/${aviso.id}`)
      .set('Authorization', e.presidente.token)

    // AN-1/D-3: el PRESIDENT es redactor, no archivista. El mensaje distingue
    // "borrar es solo de admin" de un 403 generico de rol.
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(res.body.error.message).toBe('Solo un administrador puede borrar avisos.')

    // "La fila sigue viva": el listado del ADMIN sigue conteniendolo.
    const delAdmin = await listar(e.admin.token, e.comunidad)
    expect(idsDe(delAdmin)).toContain(aviso.id)
  })

  it('un NEIGHBOR o un PROVIDER no borran', async () => {
    const e = await escena()
    const aviso = await crear(e.admin.token, e.comunidad)

    for (const [nombre, actor_] of [
      ['NEIGHBOR', e.vecinoA],
      ['PROVIDER', e.proveedor],
    ] as const) {
      const res = await request(app())
        .delete(`${V1}/announcements/${aviso.id}`)
        .set('Authorization', actor_.token)

      expect(res.status, `con rol ${nombre}`).toBe(403)
    }
  })

  it('el ADMIN borra: 200, desaparece para todos y el segundo DELETE es 404', async () => {
    const e = await escena()
    const aviso = await crear(e.admin.token, e.comunidad)

    const borrado = await request(app())
      .delete(`${V1}/announcements/${aviso.id}`)
      .set('Authorization', e.admin.token)

    // El unico DELETE de la API que responde con algo: la spec §10 fija 200,
    // y 204 no deja donde confirmar el id.
    expect(borrado.status).toBe(200)
    expect(borrado.body.data).toEqual({ id: aviso.id, deleted: true })

    // Desaparece del listado para todos los roles, gestion incluida.
    for (const [nombre, actor_] of [
      ['ADMIN', e.admin],
      ['PRESIDENT', e.presidente],
      ['NEIGHBOR', e.vecinoA],
    ] as const) {
      const res = await listar(actor_.token, e.comunidad)
      expect(idsDe(res), `con rol ${nombre}`).not.toContain(aviso.id)
    }

    // AN-5: es soft delete, la fila sigue ahi con deleted_at puesto. Es la
    // unica afirmacion de este archivo que mira la tabla con privilegio, y esta
    // aqui a proposit: un 200 de la API no prueba que la fila siga viva.
    const { admin } = await import('../db-admin.js')
    const fila = await admin.announcements.findUnique({ where: { id: aviso.id } })
    expect(fila).not.toBeNull()
    expect(fila?.deleted_at).not.toBeNull()

    // AN-11: el segundo borrado es 404, no 200 idempotente ni 409.
    const otraVez = await request(app())
      .delete(`${V1}/announcements/${aviso.id}`)
      .set('Authorization', e.admin.token)
    expect(otraVez.status).toBe(404)
    expect(otraVez.body.error.code).toBe('NOT_FOUND')

    // Y el PUT de un aviso borrado tambien es 404.
    const put = await request(app())
      .put(`${V1}/announcements/${aviso.id}`)
      .set('Authorization', e.admin.token)
      .send(putValido(aviso))
    expect(put.status).toBe(404)
  })
})

describe('Listado (AN-8, §7.3)', () => {
  it('el orden es fijados primero y publish_at descendente dentro de cada grupo', async () => {
    const e = await escena()

    const fijado = await crear(e.admin.token, e.comunidad, { isPinned: true, publishAt: enPasado(2) })
    const programado = await crear(e.admin.token, e.comunidad, { publishAt: enFuturo(5) })
    const reciente = await crear(e.admin.token, e.comunidad, { publishAt: enPasado(1) })
    const antiguo = await crear(e.admin.token, e.comunidad, { publishAt: enPasado(3) })

    // Es el orden exacto del indice announcements_community_publish_idx: no es
    // un `order by` inventado aqui, es el que el indice ya define.
    const delAdmin = await listar(e.admin.token, e.comunidad)
    expect(idsDe(delAdmin)).toEqual([fijado.id, programado.id, reciente.id, antiguo.id])

    const delVecino = await listar(e.vecinoA.token, e.comunidad)
    expect(idsDe(delVecino)).toEqual([fijado.id, reciente.id, antiguo.id])
  })

  it('la paginacion devuelve meta y una pagina mas alla del final sigue viendo el total', async () => {
    const e = await escena()
    await crear(e.admin.token, e.comunidad, { publishAt: enPasado(3) })
    await crear(e.admin.token, e.comunidad, { publishAt: enPasado(2) })
    await crear(e.admin.token, e.comunidad, { publishAt: enPasado(1) })

    const pagina1 = await listar(e.vecinoA.token, e.comunidad, '?page=1&limit=2')
    expect(pagina1.body.data).toHaveLength(2)
    expect(pagina1.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 })

    const pagina2 = await listar(e.vecinoA.token, e.comunidad, '?page=2&limit=2')
    expect(pagina2.body.data).toHaveLength(1)
    expect(pagina2.body.meta).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 })

    // El caso feo: la pagina 5 de un listado de 3. Sin el apano del servicio
    // (segunda llamada con offset 0), `count(*) over ()` no llegaria en ninguna
    // fila y meta diria total 0 para un listado que tiene tres cosas.
    const paginaMasAlla = await listar(e.vecinoA.token, e.comunidad, '?page=5&limit=2')
    expect(paginaMasAlla.body.data).toHaveLength(0)
    expect(paginaMasAlla.body.meta).toEqual({ page: 5, limit: 2, total: 3, totalPages: 2 })
  })

  it('?type filtra por tipo y ?q busca en titulo y cuerpo sin distinguir mayusculas', async () => {
    const e = await escena()

    const reunion = await crear(e.admin.token, e.comunidad, {
      title: 'Reunión extraordinaria de la escalera',
      type: 'MEETING',
    })
    await crear(e.admin.token, e.comunidad, {
      title: 'Corte de agua',
      body: 'El jueves habrá corte de agua en el portal B. Traer garrafas.',
      type: 'MAINTENANCE',
    })

    const porTipo = await listar(e.vecinoA.token, e.comunidad, '?type=MEETING')
    expect(idsDe(porTipo)).toEqual([reunion.id])

    // `q` sobre el titulo, con parte en mayusculas: ilike es case-insensitive.
    const porTitulo = await listar(e.vecinoA.token, e.comunidad, '?q=REUNI')
    expect(idsDe(porTitulo)).toEqual([reunion.id])

    // `q` sobre el cuerpo, del segundo aviso.
    const porCuerpo = await listar(e.vecinoA.token, e.comunidad, '?q=garrafas')
    expect(porCuerpo.body.data).toHaveLength(1)

    // Sin resultados: lista vacia con total 0, no un error.
    const sinResultados = await listar(e.vecinoA.token, e.comunidad, '?q=zzzznoexiste')
    expect(sinResultados.body.data).toHaveLength(0)
    expect(sinResultados.body.meta.total).toBe(0)
  })

  it('los query params invalidos son 400 y los desconocidos tambien', async () => {
    const e = await escena()

    const casos: Array<[string, string]> = [
      ['type fuera de enum', '?type=CUALQUIERA'],
      ['page 0', '?page=0'],
      ['limit 101', '?limit=101'],
      ['parametro desconocido', '?pinned=true'],
      ['q vacio', '?q='],
    ]

    for (const [nombre, query] of casos) {
      const res = await request(app())
        .get(`${V1}/communities/${e.comunidad}/announcements${query}`)
        .set('Authorization', e.vecinoA.token)

      expect(res.status, `con ${nombre}`).toBe(400)
      expect(res.body.error.code, `con ${nombre}`).toBe('VALIDATION_ERROR')
    }
  })

  it('el sobre es { data } en exito y { error: { code, message } } en fallo', async () => {
    const e = await escena()
    await crear(e.admin.token, e.comunidad)

    const ok_ = await listar(e.vecinoA.token, e.comunidad)
    expect(ok_.body).toHaveProperty('data')
    expect(ok_.body).not.toHaveProperty('error')

    const fallo = await request(app())
      .post(`${V1}/communities/${e.comunidad}/announcements`)
      .set('Authorization', e.vecinoA.token)
      .send(altaValida())

    expect(fallo.body).toHaveProperty('error')
    expect(fallo.body.error).toMatchObject({ code: 'FORBIDDEN' })
    expect(typeof fallo.body.error.message).toBe('string')
    // Sin 409 ni 422 en el modulo: los codigos salen de §7.4.
    expect([400, 401, 403, 404]).toContain(fallo.status)
  })
})
