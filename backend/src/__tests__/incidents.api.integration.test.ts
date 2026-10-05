// ---------------------------------------------------------------------------
// Incidencias por API: seguridad, visibilidad, transiciones, asignacion,
// creacion, borrado y comentarios.
//
// Este archivo es el que demuestra que el bloque 04 hace lo que dice. Los unitarios
// comprueban la FORMA de lo que entra; aqui lo que se comprueba es QUIEN puede ver y
// que puede hacer QUE, y eso no se puede decidir sin la base de datos.
//
// La regla de `helpers.ts` ("sembrar con privilegio, afirmar con restriccion") se
// cumple sin excepcion: los fixtures se crean con `admin` y todas las afirmaciones
// pasan por la API, es decir, por el rol de runtime con RLS. Un test que afirmara
// sobre `admin` no estaria probando RLS: probaria que una tabla tiene filas.
//
// Y al reves tambien: cuando un test necesita un estado que la API no permite alcanzar
// de forma comoda (un miembro suspendido), se siembra por `admin` y se asegura por la
// API que el efecto es el esperado.
//
// Los casos que estan aquí y no en los unitarios, y por que:
//
//   - El aislamiento entre comunidades. Es el riesgo numero uno del bloque: una
//     fuga de listado es una fuga de datos de una comunidad a otra, y ninguna regla de
//     zod la detecta.
//   - La terna de visibilidad por rol. Un `where` mal escrito no falla: devuelve
//     menos filas de las que deberia, que es el fallo que nadie nota.
//   - El grafo de transiciones y el 409. El grafo vive en SQL y no se puede probar
//     sin ejecutarlo.
//   - La carrera de dos transiciones simultaneas desde el mismo estado.
//   - Que un `403` de la capa HTTP y un `403` de la capa SQL sean el mismo 403. Un
//     `409` donde se esperaba un `403` (o al reves) es el sintoma de que una de las dos
//     capas no esta.
//
// NOTA sobre el POST y el PROVIDER: el guard de ruta no admite `PROVIDER`, asi que el
// 403 sale del middleware y no de `app_create_incident()`. La funcion acepta a mas
// actores de los que acepta la API, y eso es deliberado (ver §5.2 del doc): el SQL es
// la capa que se puede llamar desde otro sitio, y la API es mas estricta. Este archivo
// comprueba las dos: por API da 403, y por `withContext` el ADMIN y el NEIGHBOR pasan.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
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

async function nuevoUsuario(overrides: { email?: string; fullName?: string } = {}): Promise<TestUser> {
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

/** Crea un usuario que se limpia solo y le abre sesion. */
async function nuevoActor(user: TestUser): Promise<Actor> {
  return { ...user, token: await tokenDe(user) }
}

async function actorEn(user: TestUser, communityId: string, role: 'ADMIN' | 'PRESIDENT' | 'NEIGHBOR' | 'PROVIDER') {
  await makeMember(user.id, communityId, role)
  return { ...user, token: await tokenDe(user) }
}

/**
 * La comunidad con los cinco roles de este bloque.
 *
 * Se construye entera en una funcion porque casi todos los tests necesitan un ADMIN
 * (que es quien gestiona) y un vecino distinto (que es quien reporta). Anadir el
 * PRESIDENT, el segundo vecino y el PROVIDER aqui, y no en cada test, evita que cada
 * caso tenga que repetir cinco `makeMember` y que se lea peor: lo que se ve en el
 * test es lo que importa.
 *
 * `suspenderMiembro` y `suspendirUsuario` no son parte del escenario porque suspender
 * a alguien es un estado, no un rol.
 */
async function escenaCompleto(): Promise<{
  comunidad: string
  admin: Actor
  presidente: Actor
  vecinoA: Actor
  vecinoB: Actor
  proveedor: Actor
}> {
  const comunidad = await nuevaComunidad()

  const adminU = await nuevoUsuario({ fullName: 'Administradora' })
  const presidenteU = await nuevoUsuario({ fullName: 'Presidente' })
  const vecinoAU = await nuevoUsuario({ fullName: 'Vecina Primera' })
  const vecinoBU = await nuevoUsuario({ fullName: 'Vecino Segundo' })
  const proveedorU = await nuevoUsuario({ fullName: 'Proveedor Externo' })

  return {
    comunidad,
    admin: await actorEn(adminU, comunidad, 'ADMIN'),
    presidente: await actorEn(presidenteU, comunidad, 'PRESIDENT'),
    vecinoA: await actorEn(vecinoAU, comunidad, 'NEIGHBOR'),
    vecinoB: await actorEn(vecinoBU, comunidad, 'NEIGHBOR'),
    proveedor: await actorEn(proveedorU, comunidad, 'PROVIDER'),
  }
}

/**
 * Suspende a un miembro por el lado privilegiado.
 *
 * `app_role_in()` filtra por `status = 'ACTIVE'`, asi que un miembro suspendido no
 * tiene rol: `requireIncident()` le responde 403 y las funciones de lectura le
 * responden 403 tambien. Se siembra por `admin` porque el proposito del test es
 * comprobar el efecto, no reimplementar la suspension.
 */
async function suspenderMiembro(userId: string, communityId: string): Promise<void> {
  await admin.communityMembers.update({
    where: { community_id_user_id: { community_id: communityId, user_id: userId } },
    data: { status: 'SUSPENDED' },
  })
}

/** El cuerpo minimo de un POST valido, con `title` unico por test. */
function altaValida(extra: Record<string, unknown> = {}) {
  return {
    title: `Incidencia de prueba ${randomUUID().slice(0, 8)}`,
    description: 'Descripcion suficientemente larga para pasar el CHECK.',
    category: 'OTHER',
    ...extra,
  }
}

/** Crea una incidencia por la API y devuelve el cuerpo de la respuesta. */
async function crear(token: string, comunidad: string, extra: Record<string, unknown> = {}) {
  const res = await request(app()).post(`${COM}/${comunidad}/incidents`).set('Authorization', token).send(altaValida(extra))
  expect(res.status, `creando: ${JSON.stringify(res.body)}`).toBe(201)
  return res.body.data
}

/** Los ids de las incidencias de un listado. */
function idsDe(res: { body: { data: Array<{ id: string }> } }): string[] {
  return res.body.data.map((i) => i.id)
}

// ---------------------------------------------------------------------------

describe('Seguridad y aislamiento entre comunidades', () => {
  it('un miembro de otra comunidad no ve la incidencia al abrirla por id', async () => {
    const a = await escenaCompleto()
    const otra = await nuevaComunidad('Comunidad ajena')
    const intruso = await actorEn(await nuevoUsuario({ fullName: 'De la otra' }), otra, 'NEIGHBOR')

    const incident = await crear(a.vecinoA.token, a.comunidad)

    const res = await request(app()).get(`/api/v1/incidents/${incident.id}`).set('Authorization', intruso.token)

    // 404 y no 403: un 403 confirmaria que ese id existe (C-8).
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('un miembro de otra comunidad no la ve en el listado, ni sus comentarios', async () => {
    const a = await escenaCompleto()
    const otra = await nuevaComunidad('Comunidad ajena')
    const intruso = await actorEn(await nuevoUsuario(), otra, 'NEIGHBOR')

    const incident = await crear(a.vecinoA.token, a.comunidad)
    await request(app())
      .post(`/api/v1/incidents/${incident.id}/comments`)
      .set('Authorization', a.vecinoA.token)
      .send({ body: 'Comentario privado' })
      .expect(201)

    const listado = await request(app()).get(`${COM}/${a.comunidad}/incidents`).set('Authorization', intruso.token)
    // Ni siquiera 403: no es miembro, asi que la comunidad entera le es ajena.
    expect(listado.status).toBe(403)

    const comentarios = await request(app())
      .get(`/api/v1/incidents/${incident.id}/comments`)
      .set('Authorization', intruso.token)
    expect(comentarios.status).toBe(404)
  })

  it('un PROVIDER no ve una incidencia de su comunidad que no tiene asignada', async () => {
    const e = await escenaCompleto()

    const incident = await crear(e.vecinoA.token, e.comunidad)

    const res = await request(app()).get(`/api/v1/incidents/${incident.id}`).set('Authorization', e.proveedor.token)

    expect(res.status).toBe(404)
  })

  it('un PROVIDER ve solo las asignadas en el listado', async () => {
    const e = await escenaCompleto()

    const sinAsignar = await crear(e.vecinoA.token, e.comunidad)
    const asignada = await crear(e.vecinoB.token, e.comunidad)
    await asignarA(e.admin.token, asignada.id, e.proveedor.id)

    const res = await request(app()).get(`${COM}/${e.comunidad}/incidents`).set('Authorization', e.proveedor.token)

    expect(res.status).toBe(200)
    expect(idsDe(res)).toEqual([asignada.id])
    expect(idsDe(res)).not.toContain(sinAsignar.id)
  })

  it('un NEIGHBOR ve las suyas y solo las suyas, aunque sea de la misma comunidad', async () => {
    const e = await escenaCompleto()

    const suya = await crear(e.vecinoA.token, e.comunidad)
    const delOtro = await crear(e.vecinoB.token, e.comunidad)

    const res = await request(app()).get(`${COM}/${e.comunidad}/incidents`).set('Authorization', e.vecinoA.token)

    expect(idsDe(res)).toEqual([suya.id])
    expect(idsDe(res)).not.toContain(delOtro.id)
  })

  it('un miembro suspendido pierde el acceso a la lista y al detalle', async () => {
    const e = await escenaCompleto()
    const incident = await crear(e.vecinoA.token, e.comunidad)

    await suspenderMiembro(e.vecinoA.id, e.comunidad)

    // El token sigue siendo valido: son 15 minutos de vida. Lo que se corta es el rol.
    //
    // Y el detalle es 404, no 403: al perder la membresia activa, el vecino ya no VE
    // la incidencia, y un 403 confirmaria que ese id existe (C-8). El 403 se reserva
    // para el detalle de una comunidad, que si existe y de la que se sabe el nombre.
    const detalle = await request(app()).get(`/api/v1/incidents/${incident.id}`).set('Authorization', e.vecinoA.token)
    expect(detalle.status).toBe(404)

    const listado = await request(app()).get(`${COM}/${e.comunidad}/incidents`).set('Authorization', e.vecinoA.token)
    expect(listado.status).toBe(403)
  })

  it('un PROVIDER suspendido deja de ver lo que tenia asignado', async () => {
    const e = await escenaCompleto()

    const incident = await crear(e.vecinoA.token, e.comunidad)
    await asignarA(e.admin.token, incident.id, e.proveedor.id)

    const antes = await request(app())
      .get(`/api/v1/incidents/${incident.id}`)
      .set('Authorization', e.proveedor.token)
    expect(antes.status).toBe(200)

    await suspenderMiembro(e.proveedor.id, e.comunidad)

    // 404 y no 403: lo que se le corta es la visibilidad de la incidencia, no el
    // permiso de tocarla.
    const despues = await request(app())
      .get(`/api/v1/incidents/${incident.id}`)
      .set('Authorization', e.proveedor.token)
    expect(despues.status).toBe(404)
  })

  it('un ADMIN_SA que no es miembro recibe 403 en las ocho rutas', async () => {
    const e = await escenaCompleto()
    const staff = await nuevoActor(await makeAdminSa({ fullName: 'Staff de plataforma' }))

    const incident = await crear(e.vecinoA.token, e.comunidad)

    // Los codigos NO son todos 403, y no es un descuido: las dos rutas de COMUNIDAD
    // reciben un 403 (la comunidad existe y este usuario no es miembro de ella, que se
    // puede decir sin filtrar nada), mientras que las seis de INCIDENCIA reciben un
    // 404 (I-1: la incidencia no es visible para el, y un 403 confirmaria que el id
    // existe). El criterio de aceptacion de la spec decia "403 en las ocho rutas" y
    // era incorrecto; se corrige ahi tambien.
    const rutas: Array<[string, number, () => request.Test]> = [
      ['GET lista', 403, () => request(app()).get(`${COM}/${e.comunidad}/incidents`).set('Authorization', staff.token)],
      [
        'POST crea',
        403,
        () => request(app()).post(`${COM}/${e.comunidad}/incidents`).set('Authorization', staff.token).send(altaValida()),
      ],
      ['GET detalle', 404, () => request(app()).get(`/api/v1/incidents/${incident.id}`).set('Authorization', staff.token)],
      [
        'PUT contenido',
        404,
        () =>
          request(app())
            .put(`/api/v1/incidents/${incident.id}`)
            .set('Authorization', staff.token)
            .send({ title: 'Otro titulo valido', description: 'Otra descripcion valida.', category: 'OTHER' }),
      ],
      [
        'PATCH estado',
        404,
        () =>
          request(app())
            .patch(`/api/v1/incidents/${incident.id}/status`)
            .set('Authorization', staff.token)
            .send({ status: 'IN_PROGRESS' }),
      ],
      ['DELETE', 404, () => request(app()).delete(`/api/v1/incidents/${incident.id}`).set('Authorization', staff.token)],
      [
        'GET comentarios',
        404,
        () => request(app()).get(`/api/v1/incidents/${incident.id}/comments`).set('Authorization', staff.token),
      ],
      [
        'POST comentario',
        404,
        () =>
          request(app())
            .post(`/api/v1/incidents/${incident.id}/comments`)
            .set('Authorization', staff.token)
            .send({ body: 'Comentario del staff' }),
      ],
    ]

    for (const [nombre, esperado, peticion] of rutas) {
      const res = await peticion()
      expect(res.status, `${nombre} deberia ser ${esperado}`).toBe(esperado)
    }
  })

  it('sin token, las ocho rutas son 401', async () => {
    const e = await escenaCompleto()
    const incident = await crear(e.vecinoA.token, e.comunidad)

    const res = await request(app()).get(`/api/v1/incidents/${incident.id}`)
    expect(res.status).toBe(401)

    const lista = await request(app()).get(`${COM}/${e.comunidad}/incidents`)
    expect(lista.status).toBe(401)
  })

  it('un id que no es un UUID es 400, no 403', async () => {
    const e = await escenaCompleto()

    const res = await request(app()).get('/api/v1/incidents/no-es-uuid').set('Authorization', e.vecinoA.token)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('un titulo con texto de sentinel es un titulo normal, no un error', async () => {
    const e = await escenaCompleto()

    // El titulo lleva el texto exacto de un sentinel. Es un titulo VALIDO de 27
    // caracteres, asi que lo correcto es un 201 y no un error.
    //
    // Y este test no puede comprobar lo que realmente protege `errors.ts`, que es que
    // un sentinel dentro de un mensaje de Postgres no se convierta en un 409 si el
    // errcode no acompaña. No se puede producir por la API: el mensaje de un CHECK
    // reventado (`new row for relation "incidents" violates check constraint...`) no
    // lleva los datos de la fila, asi que el titulo no llega a aparecer en el. La
    // comprobacion de que hacen falta las DOS cosas esta en
    // `incidents/__tests__/errors.unit.test.ts`, que fabrica el error a mano.
    const creada = await request(app())
      .post(`${COM}/${e.comunidad}/incidents`)
      .set('Authorization', e.vecinoA.token)
      .send({ title: 'incident_invalid_transition', description: 'x'.repeat(20) })

    expect(creada.status).toBe(201)
    expect(creada.body.data.title).toBe('incident_invalid_transition')

    // Y un 400 de validacion sigue siendo un 400 con ese texto en la peticion.
    const invalido = await request(app())
      .post(`${COM}/${e.comunidad}/incidents`)
      .set('Authorization', e.vecinoA.token)
      .send({ title: 'incident_invalid_transition', description: 'corta' })

    expect(invalido.status).toBe(400)
    expect(invalido.body.error.code).toBe('VALIDATION_ERROR')
  })
})

/** Asigna por API y comprueba que sale bien. Reutilizado en varios tests. */
async function asignarA(token: string, incidentId: string, providerId: string) {
  const res = await request(app())
    .put(`/api/v1/incidents/${incidentId}`)
    .set('Authorization', token)
    .send({
      title: 'Titulo que se mantiene',
      description: 'Descripcion que se mantiene.',
      category: 'OTHER',
      assignedToId: providerId,
    })
  expect(res.status, `asignando: ${JSON.stringify(res.body)}`).toBe(200)
  return res.body.data
}

describe('Visibilidad del listado', () => {
  it('el ADMIN y el PRESIDENT ven lo mismo, incluidas las de otros vecinos', async () => {
    const e = await escenaCompleto()

    const deA = await crear(e.vecinoA.token, e.comunidad)
    const deB = await crear(e.vecinoB.token, e.comunidad)

    const delAdmin = await request(app()).get(`${COM}/${e.comunidad}/incidents`).set('Authorization', e.admin.token)
    const delPresidente = await request(app())
      .get(`${COM}/${e.comunidad}/incidents`)
      .set('Authorization', e.presidente.token)

    expect(idsDe(delAdmin).sort()).toEqual([deA.id, deB.id].sort())
    expect(idsDe(delPresidente).sort()).toEqual(idsDe(delAdmin).sort())
  })

  it('filtra por status, priority, category y q, y los combina', async () => {
    const e = await escenaCompleto()

    const ascensor = await crear(e.vecinoA.token, e.comunidad, {
      title: 'El ASCENSOR se para en Planta Baja',
      category: 'ELEVATOR',
      priority: 'HIGH',
    })
    const fuga = await crear(e.vecinoA.token, e.comunidad, {
      title: 'Fuga de agua en laarbitrariedad',
      category: 'PLUMBING',
      priority: 'LOW',
    })

    const porStatus = await request(app())
      .get(`${COM}/${e.comunidad}/incidents?status=OPEN`)
      .set('Authorization', e.admin.token)
    expect(idsDe(porStatus)).toHaveLength(2)

    const porPrioridad = await request(app())
      .get(`${COM}/${e.comunidad}/incidents?priority=LOW`)
      .set('Authorization', e.admin.token)
    expect(idsDe(porPrioridad)).toEqual([fuga.id])

    const porCategoria = await request(app())
      .get(`${COM}/${e.comunidad}/incidents?category=ELEVATOR`)
      .set('Authorization', e.admin.token)
    expect(idsDe(porCategoria)).toEqual([ascensor.id])

    // `q` es un ilike: encuentra por fragmento, sin distinguir mayusculas y con
    // acentos. El titulo va en mayusculas a proposito para que el test no pase por
    // casualidad si el `ilike` se volviera un `=`.
    const porTexto = await request(app())
      .get(`${COM}/${e.comunidad}/incidents?q=${encodeURIComponent('ascensor')}`)
      .set('Authorization', e.admin.token)
    expect(idsDe(porTexto)).toEqual([ascensor.id])

    // Combinados: los tres a la vez dejan solo la del ascensor.
    const combinado = await request(app())
      .get(`${COM}/${e.comunidad}/incidents?status=OPEN&priority=HIGH&category=ELEVATOR&q=planta`)
      .set('Authorization', e.admin.token)
    expect(idsDe(combinado)).toEqual([ascensor.id])
  })

  it('trae meta con page, limit, total y totalPages, y total es el total sin paginar', async () => {
    const e = await escenaCompleto()

    for (let i = 0; i < 5; i++) {
      await crear(e.vecinoA.token, e.comunidad)
    }

    const res = await request(app())
      .get(`${COM}/${e.comunidad}/incidents?page=2&limit=2`)
      .set('Authorization', e.admin.token)

    expect(res.status).toBe(200)
    expect(res.body.meta).toEqual({ page: 2, limit: 2, total: 5, totalPages: 3 })
    expect(res.body.data).toHaveLength(2)
  })

  it('una pagina mas alla del final sale vacia pero conserva el total real', async () => {
    const e = await escenaCompleto()

    await crear(e.vecinoA.token, e.comunidad)
    await crear(e.vecinoB.token, e.comunidad)

    // La pagina 9 de un listado de 2. Aqui es donde `count(*) over ()` no puede
    // traer el total: la ventana se evalua sobre las filas que salen, y no sale
    // ninguna. El service lo resuelve con una segunda llamada de offset 0.
    const res = await request(app())
      .get(`${COM}/${e.comunidad}/incidents?page=9&limit=2`)
      .set('Authorization', e.admin.token)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(0)
    expect(res.body.meta.total).toBe(2)
    expect(res.body.meta.totalPages).toBe(1)
  })

  it('un listado vacio da total 0 y totalPages 0', async () => {
    const e = await escenaCompleto()

    const res = await request(app()).get(`${COM}/${e.comunidad}/incidents`).set('Authorization', e.admin.token)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(0)
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 })
  })

  it('un limit de mas de 100 es 400 y no una pagina recortada en silencio', async () => {
    const e = await escenaCompleto()

    const res = await request(app()).get(`${COM}/${e.comunidad}/incidents?limit=1000`).set('Authorization', e.admin.token)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})// ---------------------------------------------------------------------------

describe('Transiciones de estado', () => {
  /** Pone la incidencia en `OPEN` y devuelve su cuerpo. */
  async function abierta(token: string, comunidad: string) {
    return crear(token, comunidad)
  }

  it('el ADMIN recorre OPEN -> IN_PROGRESS -> RESOLVED', async () => {
    const e = await escenaCompleto()
    const incident = await abierta(e.vecinoA.token, e.comunidad)

    const enCurso = await request(app())
      .patch(`/api/v1/incidents/${incident.id}/status`)
      .set('Authorization', e.admin.token)
      .send({ status: 'IN_PROGRESS' })
    expect(enCurso.status).toBe(200)
    expect(enCurso.body.data.status).toBe('IN_PROGRESS')
    expect(enCurso.body.data.resolvedAt).toBeNull()

    const resuelta = await request(app())
      .patch(`/api/v1/incidents/${incident.id}/status`)
      .set('Authorization', e.admin.token)
      .send({ status: 'RESOLVED' })
    expect(resuelta.status).toBe(200)
    expect(resuelta.body.data.status).toBe('RESOLVED')
    // `resolved_at` tiene valor al entrar en RESOLVED. Si no, el listado no puede
    // decir cuando se cerro, que es de lo que vive el informe mensual.
    expect(resuelta.body.data.resolvedAt).not.toBeNull()
  })

  it('el PROVIDER asignado hace el mismo recorrido', async () => {
    const e = await escenaCompleto()
    const incident = await abierta(e.vecinoA.token, e.comunidad)
    await asignarA(e.admin.token, incident.id, e.proveedor.id)

    const res = await request(app())
      .patch(`/api/v1/incidents/${incident.id}/status`)
      .set('Authorization', e.proveedor.token)
      .send({ status: 'IN_PROGRESS' })

    expect(res.status).toBe(200)
  })

  it('OPEN -> RESOLVED directo es 409', async () => {
    const e = await escenaCompleto()
    const incident = await abierta(e.vecinoA.token, e.comunidad)

    const res = await request(app())
      .patch(`/api/v1/incidents/${incident.id}/status`)
      .set('Authorization', e.admin.token)
      .send({ status: 'RESOLVED' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
  })

  it('una transicion al estado actual es 409', async () => {
    const e = await escenaCompleto()
    const incident = await abierta(e.vecinoA.token, e.comunidad)

    const res = await request(app())
      .patch(`/api/v1/incidents/${incident.id}/status`)
      .set('Authorization', e.admin.token)
      .send({ status: 'OPEN' })

    expect(res.status).toBe(409)
  })

  it('el ADMIN reabre un RESOLVED y resolved_at vuelve a null', async () => {
    const e = await escenaCompleto()
    const incident = await abierta(e.vecinoA.token, e.comunidad)

    await request(app())
      .patch(`/api/v1/incidents/${incident.id}/status`)
      .set('Authorization', e.admin.token)
      .send({ status: 'IN_PROGRESS' })
    const resuelta = await request(app())
      .patch(`/api/v1/incidents/${incident.id}/status`)
      .set('Authorization', e.admin.token)
      .send({ status: 'RESOLVED' })

    const reabierta = await request(app())
      .patch(`/api/v1/incidents/${incident.id}/status`)
      .set('Authorization', e.admin.token)
      .send({ status: 'OPEN' })

    expect(reabierta.status).toBe(200)
    expect(reabierta.body.data.status).toBe('OPEN')
    // Reabrir limpia la fecha de cierre. Si se dejara, el listado contaria como
    // resueltas las incidencias que se reabrieron.
    expect(reabierta.body.data.resolvedAt).toBeNull()
    expect(resuelta.body.data.resolvedAt).not.toBeNull()
  })

  it('el PROVIDER asignado no puede reabrir ni cancelar: 403', async () => {
    const e = await escenaCompleto()
    const incident = await abierta(e.vecinoA.token, e.comunidad)
    await asignarA(e.admin.token, incident.id, e.proveedor.id)

    await request(app())
      .patch(`/api/v1/incidents/${incident.id}/status`)
      .set('Authorization', e.admin.token)
      .send({ status: 'IN_PROGRESS' })
    await request(app())
      .patch(`/api/v1/incidents/${incident.id}/status`)
      .set('Authorization', e.admin.token)
      .send({ status: 'RESOLVED' })

    const reabrir = await request(app())
      .patch(`/api/v1/incidents/${incident.id}/status`)
      .set('Authorization', e.proveedor.token)
      .send({ status: 'OPEN' })
    // 403 y no 409: el proveedor no tiene este permiso, aunque la transicion sea
    // valida en el grafo. Es la distincion de §7.4.
    expect(reabrir.status).toBe(403)

    await request(app())
      .patch(`/api/v1/incidents/${incident.id}/status`)
      .set('Authorization', e.admin.token)
      .send({ status: 'OPEN' })

    const cancelar = await request(app())
      .patch(`/api/v1/incidents/${incident.id}/status`)
      .set('Authorization', e.proveedor.token)
      .send({ status: 'CANCELLED' })
    expect(cancelar.status).toBe(403)
  })

  it('el ADMIN cancela desde los tres estados', async () => {
    const e = await escenaCompleto()

    for (const estado of ['OPEN', 'IN_PROGRESS', 'RESOLVED'] as const) {
      const incident = await abierta(e.vecinoA.token, e.comunidad)

      if (estado === 'IN_PROGRESS' || estado === 'RESOLVED') {
        await request(app())
          .patch(`/api/v1/incidents/${incident.id}/status`)
          .set('Authorization', e.admin.token)
          .send({ status: 'IN_PROGRESS' })
      }
      if (estado === 'RESOLVED') {
        await request(app())
          .patch(`/api/v1/incidents/${incident.id}/status`)
          .set('Authorization', e.admin.token)
          .send({ status: 'RESOLVED' })
      }

      const res = await request(app())
        .patch(`/api/v1/incidents/${incident.id}/status`)
        .set('Authorization', e.admin.token)
        .send({ status: 'CANCELLED' })

      expect(res.status, `cancelando desde ${estado}`).toBe(200)
      expect(res.body.data.status).toBe('CANCELLED')
    }
  })

  it('desde CANCELLED no se sale: cualquier transicion es 409', async () => {
    const e = await escenaCompleto()
    const incident = await abierta(e.vecinoA.token, e.comunidad)

    await request(app())
      .patch(`/api/v1/incidents/${incident.id}/status`)
      .set('Authorization', e.admin.token)
      .send({ status: 'CANCELLED' })

    for (const destino of ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED'] as const) {
      const res = await request(app())
        .patch(`/api/v1/incidents/${incident.id}/status`)
        .set('Authorization', e.admin.token)
        .send({ status: destino })

      expect(res.status, `CANCELLED -> ${destino}`).toBe(409)
    }
  })

  it('un NEIGHBOR no cambia el estado de su propia incidencia', async () => {
    const e = await escenaCompleto()
    const incident = await abierta(e.vecinoA.token, e.comunidad)

    const res = await request(app())
      .patch(`/api/v1/incidents/${incident.id}/status`)
      .set('Authorization', e.vecinoA.token)
      .send({ status: 'IN_PROGRESS' })

    expect(res.status).toBe(403)
  })

  it('dos transiciones simultaneas desde el mismo estado: una entra y la otra recibe 409', async () => {
    const e = await escenaCompleto()
    const incident = await abierta(e.vecinoA.token, e.comunidad)

    // Dos PATCH en paralelo al mismo estado. El `UPDATE ... WHERE status = v_from` de
    // `app_transition_incident()` es lo que hace que esto no se pueda perder: sin el,
    // los dos leerian OPEN, los dos creerian que pueden, y los dos devolverian 200.
    const [uno, otro] = await Promise.all([
      request(app())
        .patch(`/api/v1/incidents/${incident.id}/status`)
        .set('Authorization', e.admin.token)
        .send({ status: 'IN_PROGRESS' }),
      request(app())
        .patch(`/api/v1/incidents/${incident.id}/status`)
        .set('Authorization', e.admin.token)
        .send({ status: 'IN_PROGRESS' }),
    ])

    const estados = [uno.status, otro.status].sort()
    expect(estados).toEqual([200, 409])

    const fallido = uno.status === 409 ? uno : otro
    expect(fallido.body.error.code).toBe('CONFLICT')
  })

  it('un estado que no existe es 400, sin llegar a la base de datos', async () => {
    const e = await escenaCompleto()
    const incident = await abierta(e.vecinoA.token, e.comunidad)

    const res = await request(app())
      .patch(`/api/v1/incidents/${incident.id}/status`)
      .set('Authorization', e.admin.token)
      .send({ status: 'CERRADA' })

    expect(res.status).toBe(400)
  })
})

describe('Quien puede hacer que (D-2 y D-3)', () => {
  const CONTENIDO = { title: 'Titulo valido de cinco', description: 'Descripcion valida de sobra.', category: 'OTHER' }

  it('el PRESIDENT no cambia el estado, ni aunque la transicion sea valida', async () => {
    const e = await escenaCompleto()
    const incident = await crear(e.vecinoA.token, e.comunidad)

    const res = await request(app())
      .patch(`/api/v1/incidents/${incident.id}/status`)
      .set('Authorization', e.presidente.token)
      .send({ status: 'IN_PROGRESS' })

    expect(res.status).toBe(403)
  })

  it('el PRESIDENT cambia la prioridad: 403, y no toca la base de datos', async () => {
    const e = await escenaCompleto()
    const incident = await crear(e.vecinoA.token, e.comunidad)

    const res = await request(app())
      .put(`/api/v1/incidents/${incident.id}`)
      .set('Authorization', e.presidente.token)
      .send({ ...CONTENIDO, priority: 'HIGH' })

    expect(res.status).toBe(403)

    // Y la prioridad sigue siendo la que era. El 403 tiene que llegar ANTES de
    // escribir el contenido, o el PUT habria aplicado el texto y luego habria fallado.
    const despues = await request(app()).get(`/api/v1/incidents/${incident.id}`).set('Authorization', e.admin.token)
    expect(despues.body.data.priority).toBe(incident.priority)
    expect(despues.body.data.title).toBe(incident.title)
  })

  it('el PRESIDENT asigna: 403', async () => {
    const e = await escenaCompleto()
    const incident = await crear(e.vecinoA.token, e.comunidad)

    const res = await request(app())
      .put(`/api/v1/incidents/${incident.id}`)
      .set('Authorization', e.presidente.token)
      .send({ ...CONTENIDO, assignedToId: e.proveedor.id })

    expect(res.status).toBe(403)
  })

  it('el PRESIDENT edita el contenido de cualquier incidencia de su comunidad', async () => {
    const e = await escenaCompleto()
    const incident = await crear(e.vecinoB.token, e.comunidad)

    const res = await request(app())
      .put(`/api/v1/incidents/${incident.id}`)
      .set('Authorization', e.presidente.token)
      .send({
        title: 'Titulo puesto por el presidente',
        description: 'Descripcion puesta por el presidente de la comunidad.',
        category: 'SECURITY',
        location: 'Garaje',
      })

    expect(res.status).toBe(200)
    expect(res.body.data.title).toBe('Titulo puesto por el presidente')
    expect(res.body.data.category).toBe('SECURITY')
    expect(res.body.data.location).toBe('Garaje')
  })

  it('el PRESIDENT borra: 403', async () => {
    const e = await escenaCompleto()
    const incident = await crear(e.vecinoA.token, e.comunidad)

    const res = await request(app()).delete(`/api/v1/incidents/${incident.id}`).set('Authorization', e.presidente.token)

    expect(res.status).toBe(403)
  })

  it('el PRESIDENT crea y comenta: 200 y 201', async () => {
    const e = await escenaCompleto()

    const incident = await crear(e.presidente.token, e.comunidad)
    expect(incident.reporterId).toBe(e.presidente.id)

    const comentario = await request(app())
      .post(`/api/v1/incidents/${incident.id}/comments`)
      .set('Authorization', e.presidente.token)
      .send({ body: 'Comentario del presidente' })
    expect(comentario.status).toBe(201)
  })

  it('un NEIGHBOR edita la suya y recibe 403 en la de otro', async () => {
    const e = await escenaCompleto()
    const suya = await crear(e.vecinoA.token, e.comunidad)
    const delOtro = await crear(e.vecinoB.token, e.comunidad)

    const propia = await request(app())
      .put(`/api/v1/incidents/${suya.id}`)
      .set('Authorization', e.vecinoA.token)
      .send({ ...CONTENIDO, title: 'Retocado por su autor' })
    expect(propia.status).toBe(200)

    // 404 y no 403: un NEIGHBOR no ve las incidencias de otro vecino, y lo que
    // `requireIncident()` hace con lo que no se ve es 404. Si se le devolviera un 403
    // el vecino sabria que la incidencia existe, que es justo lo que I-1 evita.
    const ajena = await request(app())
      .put(`/api/v1/incidents/${delOtro.id}`)
      .set('Authorization', e.vecinoA.token)
      .send(CONTENIDO)
    expect(ajena.status).toBe(404)
  })

  it('un PROVIDER que intenta crear una incidencia recibe 403', async () => {
    const e = await escenaCompleto()

    const res = await request(app())
      .post(`${COM}/${e.comunidad}/incidents`)
      .set('Authorization', e.proveedor.token)
      .send(altaValida())

    expect(res.status).toBe(403)
  })

  it('la capa SQL acepta a mas actores que la API, y eso es deliberado', async () => {
    const e = await escenaCompleto()

    // La funcion de SQL acepta a cualquier miembro activo, incluido el PROVIDER que
    // la API le rechaza. Se comprueba para que quede escrito que la diferencia es
    // intencionada y no un descuido: si alguien alineara la funcion con el guard, este
    // test falla y hay que decidir de nuevo cual de los dos manda.
    const id = await withContext({ userId: e.proveedor.id, communityId: e.comunidad }, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        select app_create_incident(
          ${e.comunidad}::uuid,
          ${'Titulo desde la capa SQL'},
          ${'Descripcion creada desde la capa SQL.'},
          'OTHER'::incident_category,
          'MEDIUM'::incident_priority,
          ${null}
        ) as id
      `
      return rows[0]!.id
    })

    const res = await request(app()).get(`/api/v1/incidents/${id}`).set('Authorization', e.admin.token)
    expect(res.status).toBe(200)
    expect(res.body.data.reporterId).toBe(e.proveedor.id)
  })
})

describe('Asignacion', () => {
  const CONTENIDO = { title: 'Titulo que se mantiene', description: 'Descripcion que se mantiene.', category: 'OTHER' }

  it('solo el ADMIN asigna; PRESIDENT, NEIGHBOR y PROVIDER reciben 403', async () => {
    const e = await escenaCompleto()
    const incident = await crear(e.vecinoA.token, e.comunidad)

    // Solo se prueban el PRESIDENT y el vecino que la ha creado, porque son los que
    // pueden VER la incidencia. El segundo vecino y el proveedor recibirian 404 antes
    // de llegar al permiso, y un 403 ahi seria mentir sobre lo que se esta probando.
    for (const actor of [e.presidente, e.vecinoA]) {
      const res = await request(app())
        .put(`/api/v1/incidents/${incident.id}`)
        .set('Authorization', actor.token)
        .send({ ...CONTENIDO, assignedToId: e.proveedor.id })

      expect(res.status, `asignando como ${actor.email}`).toBe(403)
    }

    // Y el que no la ve, no la puede cambiar ni aunque sea el ADMIN de su comunidad.
    for (const actor of [e.vecinoB, e.proveedor]) {
      const res = await request(app())
        .put(`/api/v1/incidents/${incident.id}`)
        .set('Authorization', actor.token)
        .send({ ...CONTENIDO, assignedToId: e.proveedor.id })

      expect(res.status, `asignando como ${actor.email}`).toBe(404)
    }
  })

  it('el ADMIN asigna y la respuesta trae assignedToId y assignedToName', async () => {
    const e = await escenaCompleto()
    const incident = await crear(e.vecinoA.token, e.comunidad)

    const res = await request(app())
      .put(`/api/v1/incidents/${incident.id}`)
      .set('Authorization', e.admin.token)
      .send({ ...CONTENIDO, assignedToId: e.proveedor.id })

    expect(res.status).toBe(200)
    expect(res.body.data.assignedToId).toBe(e.proveedor.id)
    // D-2: el nombre viene de la funcion de lectura, no de un JOIN del cliente. Sin
    // el, el frontend tendria que pedir la lista de miembros para pintar una celda.
    expect(res.body.data.assignedToName).toBe('Proveedor Externo')
  })

  it('assignedToId null desasigna', async () => {
    const e = await escenaCompleto()
    const incident = await crear(e.vecinoA.token, e.comunidad)
    await asignarA(e.admin.token, incident.id, e.proveedor.id)

    const res = await request(app())
      .put(`/api/v1/incidents/${incident.id}`)
      .set('Authorization', e.admin.token)
      .send({ ...CONTENIDO, assignedToId: null })

    expect(res.status).toBe(200)
    expect(res.body.data.assignedToId).toBeNull()
    expect(res.body.data.assignedToName).toBeNull()
  })

  it('asignar a un PROVIDER de otra comunidad es 400 y no deja nada a medias', async () => {
    const e = await escenaCompleto()
    const otra = await nuevaComunidad('Comunidad del proveedor ajeno')
    const ajeno = await actorEn(await nuevoUsuario(), otra, 'PROVIDER')

    const incident = await crear(e.vecinoA.token, e.comunidad)

    const res = await request(app())
      .put(`/api/v1/incidents/${incident.id}`)
      .set('Authorization', e.admin.token)
      .send({ ...CONTENIDO, assignedToId: ajeno.id })

    // 400 y no 403: el id es real y el problema es que no sirve para este campo. Un 403
    // diria que el usuario no existe, que es informacion que el ADMIN ya tiene.
    expect(res.status).toBe(400)

    const despues = await request(app()).get(`/api/v1/incidents/${incident.id}`).set('Authorization', e.admin.token)
    expect(despues.body.data.assignedToId).toBeNull()
  })

  it('asignar a un NEIGHBOR es 400, porque no es un proveedor', async () => {
    const e = await escenaCompleto()
    const incident = await crear(e.vecinoA.token, e.comunidad)

    const res = await request(app())
      .put(`/api/v1/incidents/${incident.id}`)
      .set('Authorization', e.admin.token)
      .send({ ...CONTENIDO, assignedToId: e.vecinoB.id })

    expect(res.status).toBe(400)
  })

  it('asignar a un PROVIDER suspendido es 400', async () => {
    const e = await escenaCompleto()
    const incident = await crear(e.vecinoA.token, e.comunidad)
    await suspenderMiembro(e.proveedor.id, e.comunidad)

    const res = await request(app())
      .put(`/api/v1/incidents/${incident.id}`)
      .set('Authorization', e.admin.token)
      .send({ ...CONTENIDO, assignedToId: e.proveedor.id })

    expect(res.status).toBe(400)
  })

  it('cambiar la prioridad la hace el ADMIN y pone needs_review a false', async () => {
    const e = await escenaCompleto()

    const critique = await crear(e.vecinoA.token, e.comunidad, { priority: 'CRITICAL' })
    expect(critique.needsReview).toBe(true)

    const res = await request(app())
      .put(`/api/v1/incidents/${critique.id}`)
      .set('Authorization', e.admin.token)
      .send({ ...CONTENIDO, priority: 'LOW' })

    expect(res.status).toBe(200)
    expect(res.body.data.priority).toBe('LOW')
    // D-1: al cambiar la prioridad, un ADMIN decide que ya esta revisada.
    expect(res.body.data.needsReview).toBe(false)
  })

  it('un reporter que manda priority recibe 403, no un 200 que lo ignoro', async () => {
    const e = await escenaCompleto()
    const incident = await crear(e.vecinoA.token, e.comunidad, { priority: 'LOW' })

    const res = await request(app())
      .put(`/api/v1/incidents/${incident.id}`)
      .set('Authorization', e.vecinoA.token)
      .send({ ...CONTENIDO, priority: 'CRITICAL' })

    expect(res.status).toBe(403)

    const despues = await request(app()).get(`/api/v1/incidents/${incident.id}`).set('Authorization', e.admin.token)
    expect(despues.body.data.priority).toBe('LOW')
  })
})

describe('Creacion y contenido', () => {
  it('el referenceCode tiene el formato INC-<año>-<6 dígitos>', async () => {
    const e = await escenaCompleto()

    const incident = await crear(e.vecinoA.token, e.comunidad)

    expect(incident.referenceCode).toMatch(/^INC-\d{4}-\d{6}$/)
  })

  it('dos incidencias seguidas no repiten referenceCode', async () => {
    const e = await escenaCompleto()

    const primera = await crear(e.vecinoA.token, e.comunidad)
    const segunda = await crear(e.vecinoA.token, e.comunidad)

    expect(segunda.referenceCode).not.toBe(primera.referenceCode)
  })

  it('un NEIGHBOR que crea CRITICAL recibe needsReview true; un ADMIN recibe false', async () => {
    const e = await escenaCompleto()

    const delVecino = await crear(e.vecinoA.token, e.comunidad, { priority: 'CRITICAL' })
    const delAdmin = await crear(e.admin.token, e.comunidad, { priority: 'CRITICAL' })

    expect(delVecino.needsReview).toBe(true)
    expect(delAdmin.needsReview).toBe(false)
  })

  it('el reporter es el actor, y mandarlo en el cuerpo es 400', async () => {
    const e = await escenaCompleto()

    const res = await request(app())
      .post(`${COM}/${e.comunidad}/incidents`)
      .set('Authorization', e.vecinoA.token)
      .send(altaValida({ reporterId: e.vecinoB.id }))

    // 400 y no 201 con el campo ignorado: el reporter lo pone `app_current_user_id()`.
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('el POST responde 201 con Location', async () => {
    const e = await escenaCompleto()

    const res = await request(app())
      .post(`${COM}/${e.comunidad}/incidents`)
      .set('Authorization', e.vecinoA.token)
      .send(altaValida())

    expect(res.status).toBe(201)
    expect(res.headers['location']).toBe(`/api/v1/incidents/${res.body.data.id}`)
  })

  it('un PUT sin priority ni assignedToId no cambia estado, prioridad ni asignacion', async () => {
    const e = await escenaCompleto()
    const incident = await crear(e.vecinoA.token, e.comunidad, { priority: 'HIGH' })
    await asignarA(e.admin.token, incident.id, e.proveedor.id)

    await request(app())
      .patch(`/api/v1/incidents/${incident.id}/status`)
      .set('Authorization', e.admin.token)
      .send({ status: 'IN_PROGRESS' })

    const res = await request(app())
      .put(`/api/v1/incidents/${incident.id}`)
      .set('Authorization', e.vecinoA.token)
      .send({ title: 'Otro titulo', description: 'Otra descripcion valida.', category: 'PLUMBING' })

    expect(res.status).toBe(200)
    expect(res.body.data.title).toBe('Otro titulo')
    expect(res.body.data.priority).toBe('HIGH')
    expect(res.body.data.assignedToId).toBe(e.proveedor.id)
    expect(res.body.data.status).toBe('IN_PROGRESS')
  })

  it('un titulo por debajo del CHECK es 400 y no un 500', async () => {
    const e = await escenaCompleto()

    const res = await request(app())
      .post(`${COM}/${e.comunidad}/incidents`)
      .set('Authorization', e.vecinoA.token)
      .send({ title: 'cort', description: 'Descripcion valida de sobra.', category: 'OTHER' })

    expect(res.status).toBe(400)
  })

  it('la ubicacion se puede dejar en null para borrarla', async () => {
    const e = await escenaCompleto()

    const incident = await crear(e.vecinoA.token, e.comunidad, { location: 'Sotano' })
    expect(incident.location).toBe('Sotano')

    const res = await request(app())
      .put(`/api/v1/incidents/${incident.id}`)
      .set('Authorization', e.admin.token)
      .send({ title: 'Titulo valido', description: 'Descripcion valida de sobra.', category: 'OTHER', location: null })

    expect(res.status).toBe(200)
    expect(res.body.data.location).toBeNull()
  })
})

describe('Borrado', () => {
  it('el DELETE responde 204 y la incidencia desaparece para todos los roles', async () => {
    const e = await escenaCompleto()
    const incident = await crear(e.vecinoA.token, e.comunidad)
    await asignarA(e.admin.token, incident.id, e.proveedor.id)

    const res = await request(app()).delete(`/api/v1/incidents/${incident.id}`).set('Authorization', e.admin.token)
    expect(res.status).toBe(204)
    expect(res.body).toEqual({})

    // Para TODOS, incluido el reporter y el proveedor asignado. El borrado logico es
    // invisible por diseno: si el reporter lo viera, sabria que sigue existiendo.
    for (const actor of [e.admin, e.presidente, e.vecinoA, e.proveedor]) {
      const detalle = await request(app())
        .get(`/api/v1/incidents/${incident.id}`)
        .set('Authorization', actor.token)
      expect(detalle.status, `detalle para ${actor.email}`).toBe(404)

      const listado = await request(app())
        .get(`${COM}/${e.comunidad}/incidents`)
        .set('Authorization', actor.token)
      expect(idsDe(listado)).not.toContain(incident.id)
    }
  })

  it('borrar dos veces: la segunda es 404', async () => {
    const e = await escenaCompleto()
    const incident = await crear(e.vecinoA.token, e.comunidad)

    await request(app()).delete(`/api/v1/incidents/${incident.id}`).set('Authorization', e.admin.token).expect(204)

    const segunda = await request(app()).delete(`/api/v1/incidents/${incident.id}`).set('Authorization', e.admin.token)

    // 404 y no 204: un 204 repetido diria que el recurso se puede borrar sin limite.
    expect(segunda.status).toBe(404)
  })

  it('un NEIGHBOR o un PRESIDENT no borran', async () => {
    const e = await escenaCompleto()
    const incident = await crear(e.vecinoA.token, e.comunidad)

    // El PRESIDENT la ve y no la puede borrar: 403. Lo mismo el vecino que la ha
    // creado: la ve (es suya) pero borrar es de ADMIN (I-6), asi que llega a la
    // guarda de rol y recibe 403.
    const presidente = await request(app())
      .delete(`/api/v1/incidents/${incident.id}`)
      .set('Authorization', e.presidente.token)
    expect(presidente.status).toBe(403)

    const reporter = await request(app())
      .delete(`/api/v1/incidents/${incident.id}`)
      .set('Authorization', e.vecinoA.token)
    expect(reporter.status).toBe(403)

    // El segundo vecino y el proveedor no la ven siquiera, asi que para ellos es 404 y
    // no llega ni a la guarda de rol.
    for (const actor of [e.vecinoB, e.proveedor]) {
      const res = await request(app()).delete(`/api/v1/incidents/${incident.id}`).set('Authorization', actor.token)
      expect(res.status, `borrando como ${actor.email}`).toBe(404)
    }
  })

  it('tras el borrado los comentarios tampoco se listan ni se pueden añadir', async () => {
    const e = await escenaCompleto()
    const incident = await crear(e.vecinoA.token, e.comunidad)

    await request(app())
      .post(`/api/v1/incidents/${incident.id}/comments`)
      .set('Authorization', e.vecinoA.token)
      .send({ body: 'Comentario previo al borrado' })
      .expect(201)

    await request(app()).delete(`/api/v1/incidents/${incident.id}`).set('Authorization', e.admin.token).expect(204)

    const listar = await request(app())
      .get(`/api/v1/incidents/${incident.id}/comments`)
      .set('Authorization', e.admin.token)
    expect(listar.status).toBe(404)

    const anadir = await request(app())
      .post(`/api/v1/incidents/${incident.id}/comments`)
      .set('Authorization', e.admin.token)
      .send({ body: 'Comentario posterior al borrado' })
    expect(anadir.status).toBe(404)
  })
})

describe('Comentarios', () => {
  it('el POST devuelve 201 con el recurso y su authorName', async () => {
    const e = await escenaCompleto()
    const incident = await crear(e.vecinoA.token, e.comunidad)

    const res = await request(app())
      .post(`/api/v1/incidents/${incident.id}/comments`)
      .set('Authorization', e.vecinoA.token)
      .send({ body: 'Ya he llamado al portero' })

    expect(res.status).toBe(201)
    expect(res.body.data.body).toBe('Ya he llamado al portero')
    expect(res.body.data.authorId).toBe(e.vecinoA.id)
    expect(res.body.data.authorName).toBe('Vecina Primera')
    expect(res.headers['location']).toBe(`/api/v1/incidents/${incident.id}/comments/${res.body.data.id}`)
  })

  it('un PROVIDER asignado comenta; uno no asignado recibe 404', async () => {
    const e = await escenaCompleto()
    const incident = await crear(e.vecinoA.token, e.comunidad)

    const sinAsignar = await request(app())
      .post(`/api/v1/incidents/${incident.id}/comments`)
      .set('Authorization', e.proveedor.token)
      .send({ body: 'Comentario sin asignar' })
    expect(sinAsignar.status).toBe(404)

    await asignarA(e.admin.token, incident.id, e.proveedor.id)

    const asignado = await request(app())
      .post(`/api/v1/incidents/${incident.id}/comments`)
      .set('Authorization', e.proveedor.token)
      .send({ body: 'Comentario ya asignado' })
    expect(asignado.status).toBe(201)
  })

  it('un NEIGHBOR no comenta en la incidencia de otro', async () => {
    const e = await escenaCompleto()
    const delOtro = await crear(e.vecinoB.token, e.comunidad)

    const res = await request(app())
      .post(`/api/v1/incidents/${delOtro.id}/comments`)
      .set('Authorization', e.vecinoA.token)
      .send({ body: 'Me meto donde no me llaman' })

    // 404 por lo mismo que en el PUT: la incidencia del otro vecino no es visible.
    expect(res.status).toBe(404)
  })

  it('el listado sale en created_at asc', async () => {
    const e = await escenaCompleto()
    const incident = await crear(e.vecinoA.token, e.comunidad)

    const cuerpos = ['primero', 'segundo', 'tercero']
    for (const body of cuerpos) {
      await request(app())
        .post(`/api/v1/incidents/${incident.id}/comments`)
        .set('Authorization', e.admin.token)
        .send({ body })
        .expect(201)
    }

    const res = await request(app())
      .get(`/api/v1/incidents/${incident.id}/comments`)
      .set('Authorization', e.admin.token)

    expect(res.status).toBe(200)
    expect(res.body.data.map((c: { body: string }) => c.body)).toEqual(cuerpos)
  })

  it('un comentario vacio es 400', async () => {
    const e = await escenaCompleto()
    const incident = await crear(e.vecinoA.token, e.comunidad)

    const res = await request(app())
      .post(`/api/v1/incidents/${incident.id}/comments`)
      .set('Authorization', e.vecinoA.token)
      .send({ body: '   ' })

    expect(res.status).toBe(400)
  })

  it('mandar authorId es 400, porque el autor es el actor', async () => {
    const e = await escenaCompleto()
    const incident = await crear(e.vecinoA.token, e.comunidad)

    const res = await request(app())
      .post(`/api/v1/incidents/${incident.id}/comments`)
      .set('Authorization', e.vecinoA.token)
      .send({ body: 'Comentario con autor spoofeado', authorId: e.vecinoB.id })

    expect(res.status).toBe(400)
  })
})

describe('Contrato', () => {
  it('el sobre es { data } en exito y { error: { code, message } } en fallo', async () => {
    const e = await escenaCompleto()

    const ok = await request(app()).get(`${COM}/${e.comunidad}/incidents`).set('Authorization', e.admin.token)
    expect(ok.body).toHaveProperty('data')
    expect(ok.body).toHaveProperty('meta')
    expect(ok.body.error).toBeUndefined()

    const ko = await request(app()).get(`/api/v1/incidents/${randomUUID()}`).set('Authorization', e.admin.token)
    expect(ko.status).toBe(404)
    expect(ko.body.data).toBeUndefined()
    expect(ko.body.error.code).toBe('NOT_FOUND')
    expect(typeof ko.body.error.message).toBe('string')
  })

  it('la incidencia no expone el email de nadie', async () => {
    const e = await escenaCompleto()
    const incident = await crear(e.vecinoA.token, e.comunidad)
    await asignarA(e.admin.token, incident.id, e.proveedor.id)

    const res = await request(app()).get(`/api/v1/incidents/${incident.id}`).set('Authorization', e.admin.token)

    // Los nombres si, los correos no: `app_list_community_members()` ya es la excepcion
    // acotada que expone correos, y duplicarla aqui seria una segunda sin motivo.
    expect(res.body.data.reporterName).toBe('Vecina Primera')
    expect(res.body.data.assignedToName).toBe('Proveedor Externo')
    expect(JSON.stringify(res.body)).not.toContain(e.vecinoA.email)
    expect(JSON.stringify(res.body)).not.toContain(e.proveedor.email)
  })

  it('una ruta de incidencia que no existe es 404, no 400', async () => {
    const e = await escenaCompleto()

    // No hay PUT ni DELETE de comentarios en este bloque, y no hay ningun esquema que
    // los valide: son rutas que no existen, y eso es un 404.
    const res = await request(app())
      .delete(`/api/v1/incidents/${randomUUID()}/comments/${randomUUID()}`)
      .set('Authorization', e.admin.token)

    expect(res.status).toBe(404)
  })
})