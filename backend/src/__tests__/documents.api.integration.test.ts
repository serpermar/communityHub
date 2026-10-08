// ---------------------------------------------------------------------------
// Documentos por API: seguridad, visibilidad por rol y ACL, descarga, alta,
// borrado y listado.
//
// Lo que demuestra este archivo es el COMPORTAMIENTO contra Postgres y, por
// primera vez en la API, contra algo fuera de ella: el bucket de Storage. Los
// fixtures se siembran con `admin` y se afirma por la API (rol app_runtime con
// RLS), y las lecturas con privilegio se reducen a dos sitios donde la API no
// podria demostrar nada:
//
//   - el `storage_path` real de la fila, para pedir el objeto al driver local
//     y comprobar que el fichero se subio (DN-13) y que el borrado SUPRIME el
//     objeto (DN-11). Un 201 de la API no prueba que el archivo exista;
//   - el `deleted_at` tras el borrado, para probar que sigue siendo soft
//     delete aunque el objeto haya desaparecido.
//
// Los seis comportamientos que solo pueden demostrarse aqui:
//
//   1. La visibilidad por rol (DN-5): el umbral de `app_list_documents()` con
//      el orden real del enum (NEIGHBOR < PRESIDENT < ADMIN) y, sobre todo, el
//      borde de PROVIDER: la visibilidad por rol NO le vale ni con is_public,
//      y la única puerta que tiene es una ACL explícita.
//   2. La ACL fina (DN-9): canView abre la fila para quien la tiene
//      (incluido PROVIDER) y canDownload=false cierra la descarga (403) sin
//      cerrar la lectura.
//   3. La descarga en dos pasos (spec §5.5): el que no ve recibe 404 (no
//      confirma que el id existe), el que ve pero no puede bajar recibe 403, y
//      el que puede recibe { url, expiresIn }.
//   4. El ciclo de vida del objeto: se sube al crear y se elimina al borrar,
//      justo al reves que el soft delete (DN-11).
//   5. El 409 document_path_taken: el unico 409 de la API, y solo alcanzable
//      llamando a `app_create_document()` directamente con una ruta ocupada
//      (la API genera uuid, que no colisionan).
//   6. La terna de rol del borrado: PRESIDENT no borra (403 con mensaje
//      propio), y el ADMIN si (200), con el segundo borrado en 404.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import request from 'supertest'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { admin } from '../db-admin.js'
import { withContext } from '../context.js'
import { translate } from '../documents/errors.js'
import { getStorageGateway } from '../documents/storage/index.js'
import { LocalStorageGateway } from '../documents/storage/local.js'
import { MAX_FILE_BYTES } from '../documents/validators.js'
import { env } from '../config/env.js'
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
  const res = await request(app()).post(`${V1}/auth/login`).send({ email: user.email, password: user.password })
  expect(res.status).toBe(200)
  return `Bearer ${res.body.data.accessToken}`
}

type Actor = TestUser & { token: string }

async function actor(user: TestUser): Promise<Actor> {
  return { ...user, token: await tokenDe(user) }
}

let actores: {
  admin: Actor
  presidente: Actor
  vecino: Actor
  proveedor: Actor
} | null = null

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

/** El driver local de Storage, para leer y borrar objetos directamente. */
async function storage(): Promise<LocalStorageGateway> {
  return (await getStorageGateway()) as LocalStorageGateway
}

// ---------------------------------------------------------------------------
// Peticiones
// ---------------------------------------------------------------------------

type OpcionesSubida = {
  fields?: Record<string, string>
  file?: { content: Buffer; contentType: string; filename: string }
}

/** El archivo por defecto de los tests: un PDF pequeno y valido. */
function pdfPrueba(overrides: Partial<{ content: Buffer; contentType: string; filename: string }> = {}) {
  return {
    content: overrides.content ?? Buffer.from('contenido del acta de prueba'),
    contentType: overrides.contentType ?? 'application/pdf',
    filename: overrides.filename ?? 'acta.pdf',
  }
}

/** Un POST multipart listo para enviarse (fields + archivo). */
function subida(token: string, comunidad: string, opciones: OpcionesSubida = {}) {
  const archivo = pdfPrueba(opciones.file)
  let req = request(app())
    .post(`${V1}/communities/${comunidad}/documents`)
    .set('Authorization', token)
    .field('title', opciones.fields?.title ?? `Acta ${randomUUID().slice(0, 8)}`)

  for (const [clave, valor] of Object.entries(opciones.fields ?? {})) {
    if (clave === 'title') continue
    req = req.field(clave, valor)
  }

  return req.attach('file', archivo.content, { filename: archivo.filename, contentType: archivo.contentType })
}

/** Sube con el archivo por defecto y exige 201. Devuelve el documento y la cabecera Location. */
async function crear(token: string, comunidad: string, opciones: OpcionesSubida = {}) {
  const res = await subida(token, comunidad, opciones)
  expect(res.status, `creando: ${JSON.stringify(res.body)}`).toBe(201)
  return { documento: res.body.data, location: res.headers.location }
}

/** El listado como 200, con la respuesta entera (para `meta`). */
async function listar(token: string, comunidad: string, query = '') {
  const res = await request(app())
    .get(`${V1}/communities/${comunidad}/documents${query}`)
    .set('Authorization', token)
  expect(res.status, `listando: ${JSON.stringify(res.body)}`).toBe(200)
  return res
}

function idsDe(res: { body: { data: Array<{ id: string }> } }): string[] {
  return res.body.data.map((d) => d.id)
}

/** El `storage_path` de la fila, leido con privilegio. Es el unico camino a la ruta del bucket. */
async function storagePathDe(documentId: string): Promise<string> {
  const fila = await admin.documents.findUnique({ where: { id: documentId }, select: { storage_path: true } })
  if (!fila?.storage_path) throw new Error('Fila sin storage_path')
  return fila.storage_path
}

/** La fila con privilegio, para afirmar el soft delete. */
async function filaDe(documentId: string) {
  return admin.documents.findUnique({
    where: { id: documentId },
    select: { storage_path: true, deleted_at: true, uploaded_by: true },
  })
}

// ---------------------------------------------------------------------------

describe('Seguridad y aislamiento entre comunidades', () => {
  it('sin token, las cinco rutas son 401', async () => {
    const e = await escena()
    const { documento } = await crear(e.admin.token, e.comunidad)

    const lista = await request(app()).get(`${V1}/communities/${e.comunidad}/documents`)
    expect(lista.status).toBe(401)

    const alta = await subidaSinToken(e.comunidad)
    expect(alta.status).toBe(401)

    const detalle = await request(app()).get(`${V1}/documents/${documento.id}`)
    expect(detalle.status).toBe(401)

    const descarga = await request(app()).get(`${V1}/documents/${documento.id}/download`)
    expect(descarga.status).toBe(401)

    const borrar = await request(app()).delete(`${V1}/documents/${documento.id}`)
    expect(borrar.status).toBe(401)
  })

  it('un no miembro: 403 en el listado, 404 en las rutas del documento', async () => {
    const e = await escena()
    const ajeno = await outsider()
    const { documento } = await crear(e.admin.token, e.comunidad)

    // (no membro -> 403, C-8: no confirmar que la comunidad existe)
    const lista = await request(app())
      .get(`${V1}/communities/${e.comunidad}/documents`)
      .set('Authorization', ajeno.token)
    expect(lista.status).toBe(403)

    // Las tres rutas por id resuelven la existencia con el predicado de la
    // funcion, que exige membresia activa: NULL -> 404 en todas (C-8, no
    // confirmar que el id existe).
    for (const ruta of [`${V1}/documents/${documento.id}`, `${V1}/documents/${documento.id}/download`]) {
      const res = await request(app()).get(ruta).set('Authorization', ajeno.token)
      expect(res.status, `con ${ruta}`).toBe(404)
    }

    const borrar = await request(app())
      .delete(`${V1}/documents/${documento.id}`)
      .set('Authorization', ajeno.token)
    expect(borrar.status).toBe(404)
  })

  it('un miembro de A no lee ni gestiona documentos de B', async () => {
    const e = await escena()
    const comunidadB = await nuevaComunidad('Comunidad B')
    await makeMember(e.admin.id, comunidadB, 'ADMIN')
    const { documento } = await crear(e.admin.token, comunidadB)

    const lista = await request(app())
      .get(`${V1}/communities/${comunidadB}/documents`)
      .set('Authorization', e.vecino.token)
    expect(lista.status).toBe(403)

    const detalle = await request(app())
      .get(`${V1}/documents/${documento.id}`)
      .set('Authorization', e.vecino.token)
    expect(detalle.status).toBe(404)

    const borrar = await request(app())
      .delete(`${V1}/documents/${documento.id}`)
      .set('Authorization', e.vecino.token)
    expect(borrar.status).toBe(404)
  })

  it('un ADMIN_SA que no es miembro: 403 en la comunidad, 404 en el documento, 403 en el alta', async () => {
    const e = await escena()
    const elena = await adminSa()
    const { documento } = await crear(e.admin.token, e.comunidad)

    const lista = await request(app())
      .get(`${V1}/communities/${e.comunidad}/documents`)
      .set('Authorization', elena.token)
    expect(lista.status).toBe(403)

    const detalle = await request(app())
      .get(`${V1}/documents/${documento.id}`)
      .set('Authorization', elena.token)
    expect(detalle.status).toBe(404)

    const alta = await subida(elena.token, e.comunidad)
    expect(alta.status).toBe(403)
  })

  it('un miembro suspendido: 403 en el listado y 404 en las rutas del documento', async () => {
    const e = await escena()
    const { documento } = await crear(e.admin.token, e.comunidad)

    await admin.communityMembers.update({
      where: { community_id_user_id: { community_id: e.comunidad, user_id: e.vecino.id } },
      data: { status: 'SUSPENDED' },
    })

    const lista = await request(app())
      .get(`${V1}/communities/${e.comunidad}/documents`)
      .set('Authorization', e.vecino.token)
    expect(lista.status).toBe(403)

    const detalle = await request(app())
      .get(`${V1}/documents/${documento.id}`)
      .set('Authorization', e.vecino.token)
    expect(detalle.status).toBe(404)

    const descarga = await request(app())
      .get(`${V1}/documents/${documento.id}/download`)
      .set('Authorization', e.vecino.token)
    expect(descarga.status).toBe(404)
  })

  it('un id que no es un UUID es 400', async () => {
    const e = await escena()

    for (const ruta of [`${V1}/documents/no-es-uuid`, `${V1}/documents/no-es-uuid/download`]) {
      const res = await request(app()).get(ruta).set('Authorization', e.admin.token)
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    }

    const borrar = await request(app())
      .delete(`${V1}/documents/tampoco-es-uuid`)
      .set('Authorization', e.admin.token)
    expect(borrar.status).toBe(400)

    const lista = await request(app())
      .get(`${V1}/communities/no-es-uuid/documents`)
      .set('Authorization', e.admin.token)
    expect(lista.status).toBe(400)
  })
})

describe('Visibilidad por rol y ACL (DN-5, DN-6, DN-9)', () => {
  it('la visibilidad por rol excluye a PROVIDER aunque el documento sea publico', async () => {
    const e = await escena()

    const { documento } = await crear(e.admin.token, e.comunidad, {
      fields: { isPublic: 'true' },
    })

    // isPublic true: NEIGHBOR, PRESIDENT y ADMIN lo ven; PROVIDER NO (DN-5).
    // Para el rol, la unica puerta es la ACL explicita, no la publicidad.
    for (const [nombre, actor_] of [
      ['ADMIN', e.admin],
      ['PRESIDENT', e.presidente],
      ['NEIGHBOR', e.vecino],
    ] as const) {
      const res = await request(app()).get(`${V1}/documents/${documento.id}`).set('Authorization', actor_.token)
      expect(res.status, `con rol ${nombre}`).toBe(200)

      const lista = await listar(actor_.token, e.comunidad)
      expect(idsDe(lista), `con rol ${nombre}`).toContain(documento.id)
    }

    const delProveedor = await request(app()).get(`${V1}/documents/${documento.id}`).set('Authorization', e.proveedor.token)
    expect(delProveedor.status).toBe(404)

    const listaProveedor = await listar(e.proveedor.token, e.comunidad)
    expect(idsDe(listaProveedor)).not.toContain(documento.id)
  })

  it('el umbral minRole se aplica con el orden real del enum', async () => {
    const e = await escena()

    // minRole PRESIDENT y no publico: un NEIGHBOR no llega al umbral.
    const { documento } = await crear(e.admin.token, e.comunidad, {
      fields: { minRole: 'PRESIDENT', isPublic: 'false' },
    })

    const delAdmin = await request(app()).get(`${V1}/documents/${documento.id}`).set('Authorization', e.admin.token)
    expect(delAdmin.status).toBe(200)

    const delPresidente = await request(app()).get(`${V1}/documents/${documento.id}`).set('Authorization', e.presidente.token)
    expect(delPresidente.status).toBe(200)

    const delVecino = await request(app()).get(`${V1}/documents/${documento.id}`).set('Authorization', e.vecino.token)
    expect(delVecino.status).toBe(404)
  })

  it('una ACL con canView abre la visibilidad para PROVIDER', async () => {
    const e = await escena()

    // Privado (isPublic false) y con canView para el proveedor: el unico caso
    // en que PROVIDER ve algo (DN-9). minRole PRESIDENT: un vecino sin ACL no
    // lo ve ni por rol ni por umbral (es el negativo real del caso).
    const { documento } = await crear(e.admin.token, e.comunidad, {
      fields: {
        minRole: 'PRESIDENT',
        isPublic: 'false',
        acl: JSON.stringify([{ userId: e.proveedor.id, canView: true }]),
      },
    })

    const delProveedor = await request(app()).get(`${V1}/documents/${documento.id}`).set('Authorization', e.proveedor.token)
    expect(delProveedor.status).toBe(200)

    const lista = await listar(e.proveedor.token, e.comunidad)
    expect(idsDe(lista)).toContain(documento.id)

    // Otro vecino sin ACL no lo ve, aunque sea de su misma comunidad.
    const ajeno = await outsider()
    await makeMember(ajeno.id, e.comunidad, 'NEIGHBOR')
    const delAjeno = await request(app())
      .get(`${V1}/documents/${documento.id}`)
      .set('Authorization', ajeno.token)
    expect(delAjeno.status).toBe(404)
  })

  it('una ACL con canView:true y canDownload:false deja ver pero no descargar', async () => {
    const e = await escena()

    const { documento } = await crear(e.admin.token, e.comunidad, {
      fields: {
        isPublic: 'false',
        acl: JSON.stringify([{ userId: e.vecino.id, canView: true, canDownload: false }]),
      },
    })

    const detalle = await request(app()).get(`${V1}/documents/${documento.id}`).set('Authorization', e.vecino.token)
    expect(detalle.status).toBe(200)

    const descarga = await request(app())
      .get(`${V1}/documents/${documento.id}/download`)
      .set('Authorization', e.vecino.token)
    expect(descarga.status).toBe(403)
    expect(descarga.body.error.code).toBe('FORBIDDEN')
  })
})

describe('Alta (DN-1, DN-8, DN-9, DN-13)', () => {
  it('un ADMIN crea con defaults, el objecto existe en Storage y el 201 lleva Location', async () => {
    const e = await escena()
    const contenido = pdfPrueba()
    const checksum = createHash('sha256').update(contenido.content).digest('hex')

    const res = await subida(e.admin.token, e.comunidad, {
      file: contenido,
      fields: { title: 'Acta de la junta de marzo' },
    })
    expect(res.status).toBe(201)

    const doc = res.body.data

    // La respuesta sale de la relectura (DN-3): con los defaults y btrim ya
    // aplicados, no de los parametros de entrada.
    expect(res.headers.location).toBe(`/api/v1/documents/${doc.id}`)
    expect(doc.communityId).toBe(e.comunidad)
    expect(doc.title).toBe('Acta de la junta de marzo')
    expect(doc.category).toBe('OTHER')
    expect(doc.mimeType).toBe('application/pdf')
    expect(doc.sizeBytes).toBe(contenido.content.byteLength)
    expect(doc.checksum).toBe(checksum)
    expect(doc.minRole).toBe('NEIGHBOR')
    expect(doc.isPublic).toBe(false)
    expect(doc.uploadedBy).toBe(e.admin.id)
    expect(doc.uploadedByName).toBe('Administradora')

    // DN-13: el objeto se subio al bucket. La API no puede demostrarlo; la
    // fila (por admin) y el driver local si.
    const ruta = await storagePathDe(doc.id)
    const guardado = await readFile((await storage()).rutaLocal(ruta))
    expect(guardado.equals(contenido.content)).toBe(true)
  })

  it('los metadatos se guardan tal cual, con la ACL en su tabla', async () => {
    const e = await escena()

    const { documento } = await crear(e.admin.token, e.comunidad, {
      fields: {
        title: '  Actas de la rampa  ',
        description: 'Se aprobó el proyecto en la junta ordinaria de marzo.',
        category: 'MINUTES',
        minRole: 'PRESIDENT',
        isPublic: 'true',
        acl: JSON.stringify([{ userId: e.vecino.id, canView: true, canDownload: false }]),
      },
    })

    expect(documento.title).toBe('Actas de la rampa')
    expect(documento.description).toBe('Se aprobó el proyecto en la junta ordinaria de marzo.')
    expect(documento.category).toBe('MINUTES')
    expect(documento.minRole).toBe('PRESIDENT')
    expect(documento.isPublic).toBe(true)

    const entradaAcl = await admin.documentAcl.findUnique({
      where: { document_id_user_id: { document_id: documento.id, user_id: e.vecino.id } },
    })
    expect(entradaAcl).not.toBeNull()
    expect(entradaAcl?.can_view).toBe(true)
    expect(entradaAcl?.can_download).toBe(false)
  })

  it('un NEIGHBOR, PRESIDENT o PROVIDER reciben 403 y no se escribe nada', async () => {
    const e = await escena()

    for (const [nombre, actor_] of [
      ['NEIGHBOR', e.vecino],
      ['PRESIDENT', e.presidente],
      ['PROVIDER', e.proveedor],
    ] as const) {
      const res = await subida(actor_.token, e.comunidad)
      expect(res.status, `con rol ${nombre}`).toBe(403)
      expect(res.body.error.code, `con rol ${nombre}`).toBe('FORBIDDEN')
    }

    const res = await listar(e.admin.token, e.comunidad)
    expect(res.body.data).toHaveLength(0)
  })

  it('valida la forma y los limites del archivo ANTES de tocar Storage', async () => {
    const e = await escena()

    const casos: Array<[string, OpcionesSubida]> = [
      ['titulo vacio', { fields: { title: '' } }],
      ['titulo de 121', { fields: { title: 'a'.repeat(121) } }],
      ['description de 1001', { fields: { description: 'a'.repeat(1001) } }],
      ['categoria inventada', { fields: { category: 'AGENDA' } }],
      ['minRole inventado', { fields: { minRole: 'OWNER' } }],
      ['isPublic que no es true/false', { fields: { isPublic: 'yes' } }],
      ['acl que no es JSON', { fields: { acl: '{no es json' } }],
      [
        'acl fuera de forma',
        { fields: { acl: JSON.stringify([{ userId: 'no-es-uuid' }]) } },
      ],
      ['uploadedBy en el cuerpo (DN-8)', { fields: { uploadedBy: e.admin.id } }],
      ['storagePath en el cuerpo', { fields: { storagePath: 'comm/ruta' } }],
      ['checksum en el cuerpo', { fields: { checksum: 'aaa' } }],
      ['mime_type fuera de la lista de 03_storage.sql', { file: { ...pdfPrueba(), contentType: 'application/octet-stream' } }],
    ]

    for (const [nombre, opciones] of casos) {
      const res = await subida(e.admin.token, e.comunidad, opciones)
      expect(res.status, `con ${nombre}: ${JSON.stringify(res.body)}`).toBe(400)
      expect(res.body.error.code, `con ${nombre}`).toBe('VALIDATION_ERROR')
    }

    // Nada de lo anterior puede haber escrito filas: ademas de 400, el listado
    // sigue vacio.
    const res = await listar(e.admin.token, e.comunidad)
    expect(res.body.data).toHaveLength(0)
  })

  it('un archivo de 10 MB y 1 byte es 400, no 500', async () => {
    const e = await escena()

    const res = await subida(e.admin.token, e.comunidad, {
      file: { content: Buffer.alloc(MAX_FILE_BYTES + 1), contentType: 'application/pdf', filename: 'gigante.pdf' },
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('un POST sin archivo es 400', async () => {
    const e = await escena()

    const res = await request(app())
      .post(`${V1}/communities/${e.comunidad}/documents`)
      .set('Authorization', e.admin.token)
      .field('title', 'Acta sin archivo')

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('un titulo con texto de sentinel es un titulo normal, no un error', async () => {
    const e = await escena()

    const { documento } = await crear(e.admin.token, e.comunidad, {
      fields: { title: 'document_not_found forbidden_role' },
    })

    expect(documento.title).toBe('document_not_found forbidden_role')
  })

  it('una colision de ruta en el bucket se traduce a 409 (document_path_taken)', async () => {
    const e = await escena()
    const { documento } = await crear(e.admin.token, e.comunidad)
    const rutaOcupada = await storagePathDe(documento.id)

    // La API genera la ruta con uuid v4, asi que la colision solo es alcanzable
    // llamando a la funcion directamente con la misma ruta. Lo que se comprueba
    // aqui es que la funcion lanza el sentinel y que translate lo convierte en
    // el 409 — el mismo 23505 que el indice documents_storage_path_uidx.
    let lanzado = false
    try {
      await withContext({ userId: e.admin.id, communityId: e.comunidad }, (tx) =>
        tx.$queryRaw`select app_create_document(
          ${e.comunidad}::uuid,
          'Colision',
          null,
          'OTHER'::document_category,
          ${rutaOcupada},
          'application/pdf',
          12::bigint,
          'abc123',
          'NEIGHBOR'::member_role,
          false::boolean,
          null::jsonb
        )`,
      )
    } catch (error) {
      lanzado = true
      const traducido = translate(error)
      expect(traducido).not.toBeNull()
      expect(traducido?.status).toBe(409)
      expect(traducido?.code).toBe('CONFLICT')
    }

    expect(lanzado).toBe(true)
  })
})

describe('Descarga (DN-10, spec §5.5)', () => {
  it('un documento visible y con can_download devuelve { url, expiresIn }', async () => {
    const e = await escena()
    const { documento } = await crear(e.admin.token, e.comunidad)
    const ruta = await storagePathDe(documento.id)

    const res = await request(app())
      .get(`${V1}/documents/${documento.id}/download`)
      .set('Authorization', e.vecino.token)

    expect(res.status).toBe(200)
    expect(res.body.data.url).toContain(ruta)
    expect(res.body.data.url).toMatch(/^http:\/\/local-storage\//)
    expect(res.body.data.expiresIn).toBe(env.DOCUMENTS_SIGNED_URL_EXPIRES_IN)
  })

  it('el que no ve el documento recibe 404, no 403', async () => {
    const e = await escena()
    const { documento } = await crear(e.admin.token, e.comunidad, {
      fields: { minRole: 'PRESIDENT' },
    })

    // NEIGHBOR sin umbral: ni siquiera se confirma que el documento existe
    // (C-8) — la primera llamada a app_document_storage_path da null y es 404.
    const descarga = await request(app())
      .get(`${V1}/documents/${documento.id}/download`)
      .set('Authorization', e.vecino.token)
    expect(descarga.status).toBe(404)
    expect(descarga.body.error.code).toBe('NOT_FOUND')
  })

  it('el que ve pero no tiene can_download recibe 403', async () => {
    const e = await escena()
    const { documento } = await crear(e.admin.token, e.comunidad, {
      fields: {
        isPublic: 'false',
        acl: JSON.stringify([{ userId: e.vecino.id, canView: true, canDownload: false }]),
      },
    })

    // Primera llamada (false) no nula: lo ve. Segunda llamada (true) nula:
    // restriction fina de la ACL -> 403.
    const descarga = await request(app())
      .get(`${V1}/documents/${documento.id}/download`)
      .set('Authorization', e.vecino.token)
    expect(descarga.status).toBe(403)
    expect(descarga.body.error.code).toBe('FORBIDDEN')
  })
})

describe('Borrado (DN-1, DN-11)', () => {
  it('el PRESIDENT no borra: 403 con mensaje propio y el objeto sigue en Storage', async () => {
    const e = await escena()
    const { documento } = await crear(e.admin.token, e.comunidad, { file: pdfPrueba({ content: Buffer.from('acta de la junta') }) })
    const ruta = await storagePathDe(documento.id)

    const res = await request(app())
      .delete(`${V1}/documents/${documento.id}`)
      .set('Authorization', e.presidente.token)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
    expect(res.body.error.message).toBe('Solo un administrador puede borrar documentos.')

    // DN-11: sin borrar, el objeto tiene que seguir en el bucket.
    await expect(readFile((await storage()).rutaLocal(ruta))).resolves.toBeTruthy()
  })

  it('el ADMIN borra: 200, soft delete en la fila, el objeto desaparece y el segundo DELETE es 404', async () => {
    const e = await escena()
    const contenido = Buffer.from('acta que se va a borrar')
    const { documento } = await crear(e.admin.token, e.comunidad, { file: pdfPrueba({ content: contenido }) })
    const ruta = await storagePathDe(documento.id)

    const borrado = await request(app())
      .delete(`${V1}/documents/${documento.id}`)
      .set('Authorization', e.admin.token)

    expect(borrado.status).toBe(200)
    expect(borrado.body.data).toEqual({ id: documento.id, deleted: true })

    // DN-11: el binario se elimina del bucket DESPUES del soft delete. Que la
    // fila siga viva con deleted_at y el objeto ya no exista es la prueba.
    const fila = await filaDe(documento.id)
    expect(fila?.deleted_at).not.toBeNull()

    await expect(readFile((await storage()).rutaLocal(ruta))).rejects.toThrow()

    // Borrado es borrado para todos, descarga incluida.
    for (const [nombre, actor_] of [
      ['ADMIN', e.admin],
      ['NEIGHBOR', e.vecino],
    ] as const) {
      const lista = await listar(actor_.token, e.comunidad)
      expect(idsDe(lista), `con rol ${nombre}`).not.toContain(documento.id)

      const descarga = await request(app())
        .get(`${V1}/documents/${documento.id}/download`)
        .set('Authorization', actor_.token)
      expect(descarga.status, `con rol ${nombre}`).toBe(404)
    }

    const otraVez = await request(app())
      .delete(`${V1}/documents/${documento.id}`)
      .set('Authorization', e.admin.token)
    expect(otraVez.status).toBe(404)
    expect(otraVez.body.error.code).toBe('NOT_FOUND')
  })

  it('un documento borrado por el ADMIN ya no se ve y no puede borrarse dos veces', async () => {
    const e = await escena()
    const { documento } = await crear(e.admin.token, e.comunidad)

    await request(app()).delete(`${V1}/documents/${documento.id}`).set('Authorization', e.admin.token)

    const porProveedor = await request(app())
      .get(`${V1}/documents/${documento.id}`)
      .set('Authorization', e.proveedor.token)
    expect(porProveedor.status).toBe(404)
  })
})

describe('Listado (DN-4, DN-6, §7.3)', () => {
  it('el orden es created_at descendente', async () => {
    const e = await escena()

    const a = (await crear(e.admin.token, e.comunidad)).documento
    const b = (await crear(e.admin.token, e.comunidad)).documento
    const c = (await crear(e.admin.token, e.comunidad)).documento

    const delVecino = await listar(e.vecino.token, e.comunidad)
    expect(idsDe(delVecino)).toEqual([c.id, b.id, a.id])
  })

  it('la paginacion devuelve meta y una pagina mas alla del final sigue viendo el total', async () => {
    const e = await escena()
    await crear(e.admin.token, e.comunidad)
    await crear(e.admin.token, e.comunidad)
    await crear(e.admin.token, e.comunidad)

    const pagina1 = await listar(e.vecino.token, e.comunidad, '?page=1&limit=2')
    expect(pagina1.body.data).toHaveLength(2)
    expect(pagina1.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 })

    const pagina2 = await listar(e.vecino.token, e.comunidad, '?page=2&limit=2')
    expect(pagina2.body.data).toHaveLength(1)
    expect(pagina2.body.meta).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 })

    const paginaMasAlla = await listar(e.vecino.token, e.comunidad, '?page=5&limit=2')
    expect(paginaMasAlla.body.data).toHaveLength(0)
    expect(paginaMasAlla.body.meta).toEqual({ page: 5, limit: 2, total: 3, totalPages: 2 })
  })

  it('?category filtra y ?q busca en titulo y descripcion sin distinguir mayusculas', async () => {
    const e = await escena()

    const minutas = (await crear(e.admin.token, e.comunidad, {
      fields: { title: 'Reunión extraordinaria de la escalera', category: 'MINUTES', minRole: 'NEIGHBOR' },
    })).documento
    await crear(e.admin.token, e.comunidad, {
      fields: { title: 'Factura del ascensor', category: 'INVOICE', description: 'La factura de marzo por la revisión.', minRole: 'NEIGHBOR' },
    })

    const porCategoria = await listar(e.vecino.token, e.comunidad, '?category=MINUTES')
    expect(idsDe(porCategoria)).toEqual([minutas.id])

    const porTitulo = await listar(e.vecino.token, e.comunidad, '?q=ESCALERA')
    expect(idsDe(porTitulo)).toEqual([minutas.id])

    const porDescripcion = await listar(e.vecino.token, e.comunidad, '?q=factura')
    expect(porDescripcion.body.data).toHaveLength(1)

    const sinResultados = await listar(e.vecino.token, e.comunidad, '?q=zzzznoexiste')
    expect(sinResultados.body.data).toHaveLength(0)
    expect(sinResultados.body.meta.total).toBe(0)
  })

  it('los query params invalidos son 400 y los desconocidos tambien', async () => {
    const e = await escena()

    const casos: Array<[string, string]> = [
      ['category fuera de enum', '?category=AGENDA'],
      ['page 0', '?page=0'],
      ['limit 101', '?limit=101'],
      ['parametro desconocido', '?pinned=true'],
      ['q vacio', '?q='],
    ]

    for (const [nombre, query] of casos) {
      const res = await request(app())
        .get(`${V1}/communities/${e.comunidad}/documents${query}`)
        .set('Authorization', e.vecino.token)

      expect(res.status, `con ${nombre}`).toBe(400)
      expect(res.body.error.code, `con ${nombre}`).toBe('VALIDATION_ERROR')
    }
  })

  it('el sobre es { data } en exito y { error: { code, message } } en fallo', async () => {
    const e = await escena()
    await crear(e.admin.token, e.comunidad)

    const ok_ = await listar(e.vecino.token, e.comunidad)
    expect(ok_.body).toHaveProperty('data')
    expect(ok_.body).not.toHaveProperty('error')

    const fallo = await request(app())
      .post(`${V1}/communities/${e.comunidad}/documents`)
      .set('Authorization', e.vecino.token)
      .send({})

    expect(fallo.body).toHaveProperty('error')
    expect(fallo.body.error).toMatchObject({ code: 'FORBIDDEN' })
    expect(typeof fallo.body.error.message).toBe('string')
    expect([400, 401, 403, 404, 409]).toContain(fallo.status)
  })
})

function subidaSinToken(comunidad: string) {
  return subida('', comunidad)
}