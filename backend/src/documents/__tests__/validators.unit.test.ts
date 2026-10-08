// ---------------------------------------------------------------------------
// Validadores de documentos.
//
// Tests unitarios, sin base de datos. Se comprueba la forma de lo que entra,
// con el mismo mapa por partes que los demas bloques:
//
//   - Los ENUM (`category`, `minRole`) se listan, no se dejan pasar como texto
//     libre. Sin la lista, un `category=inventado` llegaria al SQL y Postgres
//     lo rechazaria con 22P02, que sin traduccion es un 500.
//   - Los limites de longitud son copia de los CHECK de 02i_documents.sql
//     (`documents_title_length` 1-120, `documents_description_length` 1-1000).
//   - `.strict()` en los tres esquemas: mandar `uploadedBy`, `communityId`,
//     `storagePath`, `mimeType`, `sizeBytes` o `checksum` es un 400 — DN-9
//     divide en dos la fuente de esos campos (quien sube lo escribe la
//     funcion; la ruta, el tipo, el peso y el hash los decide el backend).
//   - El POST es multipart, asi que `isPublic` acepta 'true'/'false' y el `acl`
//     es un TEXTO con JSON que este esquema valida campo a campo (un JSON
//     invalido nunca debe llegar al `::jsonb` de la funcion).
//
// La normalizacion de `'' -> null` de description se comprueba aqui: es la
// pieza que separa "no lo mandaste" de "lo mandaste vacio" en una columna
// nullable, y sin ella un description de 1001 caracteres podria colarse de la
// mano del borde.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import {
  CATEGORIAS_VALIDAS,
  MAX_FILE_BYTES,
  MAX_FILE_MESSAGE,
  MIME_PERMITIDOS,
  MIN_ROLES_VALIDOS,
  createDocumentSchema,
  listQuerySchema,
  mimePermitido,
  uuidSchema,
} from '../validators.js'

const UUID = '11111111-1111-4111-8111-111111111111'

/** Un cuerpo de POST multipart valido, para romper una cosa cada vez. */
const ALTA_VALIDA = {
  title: 'Acta de la junta de marzo',
  description: 'Se aprobó la partida de la rampa y el presupuesto de jardinería.',
  category: 'MINUTES',
  minRole: 'PRESIDENT',
  isPublic: 'true',
  acl: JSON.stringify([{ userId: '22222222-2222-4222-8222-222222222222', canView: true, canDownload: false }]),
}

describe('createDocumentSchema', () => {
  it('acepta un cuerpo valido', () => {
    const resultado = createDocumentSchema.safeParse(ALTA_VALIDA)

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.title).toBe(ALTA_VALIDA.title)
      expect(resultado.data.isPublic).toBe(true)
      expect(resultado.data.acl).toEqual([
        { userId: '22222222-2222-4222-8222-222222222222', canView: true, canDownload: false },
      ])
    }
  })

  it('hace category, minRole, isPublic y acl opcionales', () => {
    // Los defaults los pone `app_create_document()` con los mismos `coalesce`
    // que los defaults de la columna; si aqui se pusieran valores, los dos
    // sitios podrian discrepar.
    const resultado = createDocumentSchema.safeParse({ title: 'Solo el título' })

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.category).toBeUndefined()
      expect(resultado.data.minRole).toBeUndefined()
      expect(resultado.data.isPublic).toBeUndefined()
      expect(resultado.data.acl).toBeUndefined()
    }
  })

  it('acepta las seis categorias y los cuatro roles', () => {
    for (const category of CATEGORIAS_VALIDAS) {
      expect(createDocumentSchema.safeParse({ ...ALTA_VALIDA, category }).success, `con category ${category}`).toBe(true)
    }

    for (const minRole of MIN_ROLES_VALIDOS) {
      expect(createDocumentSchema.safeParse({ ...ALTA_VALIDA, minRole }).success, `con minRole ${minRole}`).toBe(true)
    }
  })

  it('rechaza un enum inventado', () => {
    for (const category of ['AGENDA', 'minutes', 'POLIZA', '']) {
      expect(
        createDocumentSchema.safeParse({ ...ALTA_VALIDA, category }).success,
        `con category ${JSON.stringify(category)}`,
      ).toBe(false)
    }

    for (const minRole of ['OWNER', 'president', 'ADMIN_SA', '']) {
      expect(
        createDocumentSchema.safeParse({ ...ALTA_VALIDA, minRole }).success,
        `con minRole ${JSON.stringify(minRole)}`,
      ).toBe(false)
    }
  })

  it('aplica los mismos limites que los CHECK de la tabla', () => {
    // 1 y 120 son `documents_title_length`; 1 y 1000 `documents_description_length`.
    expect(createDocumentSchema.safeParse({ ...ALTA_VALIDA, title: '' }).success).toBe(false)
    expect(createDocumentSchema.safeParse({ ...ALTA_VALIDA, title: 'a'.repeat(1) }).success).toBe(true)
    expect(createDocumentSchema.safeParse({ ...ALTA_VALIDA, title: 'a'.repeat(120) }).success).toBe(true)
    expect(createDocumentSchema.safeParse({ ...ALTA_VALIDA, title: 'a'.repeat(121) }).success).toBe(false)

    // La descripcion es opcional: 0 es el minimo admitido (como null). 1001 no.
    expect(createDocumentSchema.safeParse({ ...ALTA_VALIDA, description: 'a'.repeat(1) }).success).toBe(true)
    expect(createDocumentSchema.safeParse({ ...ALTA_VALIDA, description: 'a'.repeat(1000) }).success).toBe(true)
    expect(createDocumentSchema.safeParse({ ...ALTA_VALIDA, description: 'a'.repeat(1001) }).success).toBe(false)
  })

  it('aplica el trim antes de medir la longitud', () => {
    // Sin trim, un titulo de tres espacios pasaria el minimo de 1 aqui y
    // revienta el CHECK de la tabla.
    expect(createDocumentSchema.safeParse({ ...ALTA_VALIDA, title: '   ' }).success).toBe(false)
    expect(createDocumentSchema.safeParse({ ...ALTA_VALIDA, title: '   junta   ' }).success).toBe(true)
  })

  it('aplica el trim y su resultado a la descripcion', () => {
    const resultado = createDocumentSchema.safeParse(ALTA_VALIDA)

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.description).toBe(ALTA_VALIDA.description)
    }
  })

  it('normaliza description "" a null', () => {
    // En multipart es imposible distinguir "no viene" de "viene vacio": los dos
    // son una clave ausente. El transform convierte "" en null para que el
    // almacenamiento sea uniforme.
    const resultado = createDocumentSchema.safeParse({
      ...ALTA_VALIDA,
      description: '',
      acl: undefined,
    })

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.description).toBeNull()
    }
  })

  it('convierte isPublic "true"/"false" a boolean', () => {
    const conTrue = createDocumentSchema.safeParse({ ...ALTA_VALIDA, isPublic: 'true' })
    const conFalse = createDocumentSchema.safeParse({ ...ALTA_VALIDA, isPublic: 'false' })

    expect(conTrue.success).toBe(true)
    expect(conFalse.success).toBe(true)
    if (conTrue.success) expect(conTrue.data.isPublic).toBe(true)
    if (conFalse.success) expect(conFalse.data.isPublic).toBe(false)
  })

  it('rechaza un isPublic que no sea true/false', () => {
    // `?isPublic=1`, `isPublic=yes` o incluso `isPublic=` en blanco no
    // distinguen de "lo mandó mal": la funcion recibe un boolean y el default
    // (false) lo pone la funcion, no un texto medio vacio.
    for (const malo of ['yes', '1', 'TRUE', 'true ', '']) {
      expect(createDocumentSchema.safeParse({ ...ALTA_VALIDA, isPublic: malo }).success, `con isPublic ${JSON.stringify(malo)}`).toBe(
        false,
      )
    }
  })

  it('parsea el acl como JSON y valida cada entrada', () => {
    const resultado = createDocumentSchema.safeParse({
      ...ALTA_VALIDA,
      acl: JSON.stringify([
        { userId: UUID, canView: true },
        { userId: '22222222-2222-4222-8222-222222222222', canDownload: false },
      ]),
    })

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.acl).toEqual([
        { userId: UUID, canView: true },
        { userId: '22222222-2222-4222-8222-222222222222', canDownload: false },
      ])
    }
  })

  it('normaliza acl ausente o "" a undefined', () => {
    const ausente = createDocumentSchema.safeParse({ title: 'Sin acl' })
    const vacio = createDocumentSchema.safeParse({ title: 'Sin acl', acl: '   ' })

    expect(ausente.success).toBe(true)
    expect(vacio.success).toBe(true)
    if (ausente.success) expect(ausente.data.acl).toBeUndefined()
    if (vacio.success) expect(vacio.data.acl).toBeUndefined()
  })

  it('rechaza un acl que no es JSON valido', () => {
    const resultado = createDocumentSchema.safeParse({ ...ALTA_VALIDA, acl: '{no es json' })

    expect(resultado.success).toBe(false)
  })

  it('rechaza un acl que no es una lista de entradas', () => {
    for (const malo of [
      '{"userId": "11111111-1111-4111-8111-111111111111"}',
      '[{"userId": "no-es-uuid"}]',
      '["un texto"]',
      'null',
    ]) {
      expect(createDocumentSchema.safeParse({ ...ALTA_VALIDA, acl: malo }).success, `con acl ${malo}`).toBe(false)
    }
  })

  it('acepta una lista vacia de entradas (equivale a "sin ACL")', () => {
    const resultado = createDocumentSchema.safeParse({ ...ALTA_VALIDA, acl: '[]' })

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.acl).toEqual([])
    }
  })

  it('rechaza una entrada de acl con claves desconocidas', () => {
    expect(
      createDocumentSchema.safeParse({
        ...ALTA_VALIDA,
        acl: JSON.stringify([{ userId: UUID, canView: true, role: 'ADMIN' }]),
      }).success,
    ).toBe(false)
  })

  it('no acepta los campos que escribe la funcion o el backend (DN-8/DN-9)', () => {
    // La autoria sale de app_current_user_id(); la ruta, el mime, el peso y el
    // hash, del archivo y de este backend. Mandarlos es un 400.
    for (const clave of ['uploadedBy', 'communityId', 'storagePath', 'mimeType', 'sizeBytes', 'checksum']) {
      expect(
        createDocumentSchema.safeParse({ ...ALTA_VALIDA, [clave]: clave === 'sizeBytes' ? 12 : 'valor' }).success,
        `con la clave ${clave}`,
      ).toBe(false)
    }
  })

  it('rechaza cualquier otra clave desconocida', () => {
    for (const clave of ['id', 'createdAt', 'updatedAt', 'deletedAt', 'documentId']) {
      expect(
        createDocumentSchema.safeParse({ ...ALTA_VALIDA, [clave]: 'lo-que-sea' }).success,
        `con la clave ${clave}`,
      ).toBe(false)
    }
  })

  it('rechaza un cuerpo vacio', () => {
    expect(createDocumentSchema.safeParse({}).success).toBe(false)
  })
})

describe('listQuerySchema', () => {
  it('acepta un listado sin filtros', () => {
    const resultado = listQuerySchema.safeParse({})

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.category).toBeUndefined()
      expect(resultado.data.q).toBeUndefined()
      expect(resultado.data.page).toBeUndefined()
      expect(resultado.data.limit).toBeUndefined()
    }
  })

  it('convierte page y limit de texto a numero', () => {
    const resultado = listQuerySchema.safeParse({ page: '2', limit: '50' })

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.page).toBe(2)
      expect(resultado.data.limit).toBe(50)
    }
  })

  it('rechaza page 0 y page con letra', () => {
    expect(listQuerySchema.safeParse({ page: '0' }).success).toBe(false)
    expect(listQuerySchema.safeParse({ page: 'abc' }).success).toBe(false)
    expect(listQuerySchema.safeParse({ page: '1.5' }).success).toBe(false)
    expect(listQuerySchema.safeParse({ page: 1 }).success).toBe(true)
  })

  it('acota limit a 100', () => {
    expect(listQuerySchema.safeParse({ limit: '100' }).success).toBe(true)
    expect(listQuerySchema.safeParse({ limit: '101' }).success).toBe(false)
    expect(listQuerySchema.safeParse({ limit: '0' }).success).toBe(false)
  })

  it('rechaza un filtro de enum que no existe', () => {
    for (const category of ['AGENDA', 'minutes', 'GENERAL', '']) {
      expect(listQuerySchema.safeParse({ category }).success, `con category ${JSON.stringify(category)}`).toBe(false)
    }
  })

  it('acota q a 100 caracteres y rechaza el vacio', () => {
    expect(listQuerySchema.safeParse({ q: 'rampa' }).success).toBe(true)
    expect(listQuerySchema.safeParse({ q: 'a'.repeat(100) }).success).toBe(true)
    expect(listQuerySchema.safeParse({ q: 'a'.repeat(101) }).success).toBe(false)
    expect(listQuerySchema.safeParse({ q: '' }).success).toBe(false)
    expect(listQuerySchema.safeParse({ q: '   ' }).success).toBe(false)
  })

  it('rechaza una clave desconocida', () => {
    expect(listQuerySchema.safeParse({ pinned: 'true' }).success).toBe(false)
    expect(listQuerySchema.safeParse({ communityId: UUID }).success).toBe(false)
  })
})

describe('uuidSchema', () => {
  it('acepta un UUID con las dos cajas', () => {
    expect(uuidSchema.safeParse(UUID).success).toBe(true)
    expect(uuidSchema.safeParse(UUID.toUpperCase()).success).toBe(true)
  })

  it('rechaza lo que no es un UUID', () => {
    for (const malo of ['', 'abc', '1', '11111111-1111-4111-8111-11111111111']) {
      expect(uuidSchema.safeParse(malo).success, `con ${JSON.stringify(malo)}`).toBe(false)
    }
  })
})

describe('MIME_PERMITIDOS y MAX_FILE_BYTES', () => {
  it('la lista coincide con la de 03_storage.sql', () => {
    expect(MIME_PERMITIDOS).toContain('application/pdf')
    expect(MIME_PERMITIDOS).toContain('image/png')
    expect(MIME_PERMITIDOS).toContain('text/csv')
    expect(MIME_PERMITIDOS).not.toContain('application/octet-stream')
    expect(MIME_PERMITIDOS).not.toContain('text/html')
  })

  it('mimePermitido decide por la lista', () => {
    expect(mimePermitido('application/pdf')).toBe(true)
    expect(mimePermitido('audio/mpeg')).toBe(false)
  })

  it('MAX_FILE_BYTES es 10 MB', () => {
    expect(MAX_FILE_BYTES).toBe(10 * 1024 * 1024)
    expect(MAX_FILE_MESSAGE).toContain('10 MB')
  })
})