// ---------------------------------------------------------------------------
// Validadores de incidencias.
//
// Tests unitarios: no abren la base de datos. Lo que se comprueba aqui es la FORMA
// de lo que entra, que es la unica parte de este bloque que se puede comprobar sin
// Supabase.
//
// Lo que importa no es que zod funcione, sino el motivo de cada regla:
//
//   - Los ENUM se listan, no se dejan pasar como texto libre. Sin esta lista,
//     `status=inventado` llegaria al SQL y Postgres lo rechazaria con 22P02, que sin
//     traduccion es un 500. Aqui es un 400 que ademas nombra el campo.
//   - Los limites de longitud son copia de los CHECK de `incidents_title_length` y
//     `incidents_description_length`. El backend no puede leer constraints, y el
//     unico sitio donde se puede equivocar sin que nadie lo note es el que se
//     comprueba despues del otro.
//   - `.strict()` en los cinco esquemas: una clave desconocida es un error, no algo
//     que se ignora en silencio. En el POST es lo que hace que mandar `reporterId`
//     sea un 400 en vez de un 201 con el campo descartado (I-5).
//   - `location: ''` y `location: null` se convierten en el mismo `null`, para que el
//     PUT pueda borrar la ubicacion.
//
// Lo que NO se comprueba aqui, y por que:
//
//   - Que el SQL acepte lo que zod deja pasar. Eso es de los tests de integracion.
//   - Que los limites de aqui y los CHECK de ahi coincidan. Tambien de integracion,
//     porque solo ahi se puede insertar un titulo de 4 caracteres y ver que la base de
//     datos lo acepta.
//
// La normalizacion de `title` y `description` (el `trim`) se comprueba aqui porque es
// pura funcion de zod, y tiene una consecuencia que se nota mas tarde: sin el `trim`,
// un titulo de cinco espacios pasa la validacion de la aplicacion y revienta el CHECK
// de la tabla.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import {
  CATEGORIAS_VALIDAS,
  ESTADOS_VALIDOS,
  createCommentSchema,
  createIncidentSchema,
  listQuerySchema,
  transitionIncidentSchema,
  updateIncidentSchema,
  uuidSchema,
} from '../validators.js'

/** Un cuerpo de POST valido, para partir de aqui y romper una cosa cada vez. */
const ALTA_VALIDA = {
  title: 'El ascensor se para en planta baja',
  description: 'Se para al subir y hay gente esperando dentro.',
  category: 'ELEVATOR' as const,
  priority: 'HIGH' as const,
  location: 'Puerta principal',
}

describe('createIncidentSchema', () => {
  it('acepta un cuerpo valido', () => {
    expect(createIncidentSchema.safeParse(ALTA_VALIDA).success).toBe(true)
  })

  it('hace category y priority opcionales', () => {
    const resultado = createIncidentSchema.safeParse({
      title: ALTA_VALIDA.title,
      description: ALTA_VALIDA.description,
    })

    expect(resultado.success).toBe(true)
    // Quedan `undefined`, no un valor inventado. El default de la columna y el de la
    // funcion son la fuente, y no este archivo: si aqui se pusiera 'OTHER', un cliente
    // que omita el campo y una funcion que lo omita podrian discrepar.
    if (resultado.success) {
      expect(resultado.data.category).toBeUndefined()
      expect(resultado.data.priority).toBeUndefined()
    }
  })

  it('acepta los siete valores de category', () => {
    for (const category of CATEGORIAS_VALIDAS) {
      expect(
        createIncidentSchema.safeParse({ ...ALTA_VALIDA, category }).success,
        `con category ${category}`,
      ).toBe(true)
    }
  })

  it('rechaza un enum inventado', () => {
    for (const category of ['ASCENSOR', 'elevator', 'OTRO', '']) {
      expect(
        createIncidentSchema.safeParse({ ...ALTA_VALIDA, category }).success,
        `con category ${JSON.stringify(category)}`,
      ).toBe(false)
    }
  })

  it('aplica los mismos limites que los CHECK de la tabla', () => {
    // 4 y 201 son los lados de `incidents_title_length`; 9 y 4001 los de
    // `incidents_description_length`. Estos numeros estan en los dos sitios, y por eso
    // estan escritos aqui a mano y no calculados.
    expect(createIncidentSchema.safeParse({ ...ALTA_VALIDA, title: 'a'.repeat(4) }).success).toBe(false)
    expect(createIncidentSchema.safeParse({ ...ALTA_VALIDA, title: 'a'.repeat(5) }).success).toBe(true)
    expect(createIncidentSchema.safeParse({ ...ALTA_VALIDA, title: 'a'.repeat(200) }).success).toBe(true)
    expect(createIncidentSchema.safeParse({ ...ALTA_VALIDA, title: 'a'.repeat(201) }).success).toBe(false)

    expect(createIncidentSchema.safeParse({ ...ALTA_VALIDA, description: 'a'.repeat(9) }).success).toBe(false)
    expect(createIncidentSchema.safeParse({ ...ALTA_VALIDA, description: 'a'.repeat(10) }).success).toBe(true)
    expect(createIncidentSchema.safeParse({ ...ALTA_VALIDA, description: 'a'.repeat(4001) }).success).toBe(false)
  })

  it('aplica el trim antes de medir la longitud', () => {
    // Sin trim, cinco espacios serian un titulo de cinco caracteres y pasarian aqui,
    // pero el CHECK de la tabla lo mediria despues de insertar los espacios.
    const resultado = createIncidentSchema.safeParse({
      ...ALTA_VALIDA,
      title: '     ',
      description: '          ',
    })

    expect(resultado.success).toBe(false)
  })

  it('convierte location vacia, nula y ausente en lo mismo', () => {
    const vacia = createIncidentSchema.safeParse({ ...ALTA_VALIDA, location: '   ' })
    const nula = createIncidentSchema.safeParse({ ...ALTA_VALIDA, location: null })
    // Sin `location` en el objeto, para comprobar el tercer caso de verdad: si se
    // dejara puesto el de ALTA_VALIDA, esto no estaria probando nada.
    const { location: _omitida, ...sinLocation } = ALTA_VALIDA
    const ausente = createIncidentSchema.safeParse(sinLocation)

    expect(vacia.success && vacia.data.location).toBeNull()
    expect(nula.success && nula.data.location).toBeNull()
    expect(ausente.success && ausente.data.location).toBeNull()
  })

  it('rechaza reporterId, que es la regla de I-5', () => {
    // El caso que mas importa: el reporter lo pone la funcion, asi que aceptarlo
    // seria permitir que el cuerpo diga quien es el autor.
    const resultado = createIncidentSchema.safeParse({
      ...ALTA_VALIDA,
      reporterId: '11111111-1111-4111-8111-111111111111',
    })

    expect(resultado.success).toBe(false)
  })

  it('rechaza cualquier clave desconocida', () => {
    for (const clave of ['status', 'needsReview', 'resolvedAt', 'createdVia', 'id']) {
      expect(
        createIncidentSchema.safeParse({ ...ALTA_VALIDA, [clave]: 'lo-que-sea' }).success,
        `con la clave ${clave}`,
      ).toBe(false)
    }
  })

  it('rechaza un cuerpo vacio', () => {
    expect(createIncidentSchema.safeParse({}).success).toBe(false)
  })
})

describe('updateIncidentSchema', () => {
  const PUT_VALIDO = {
    title: ALTA_VALIDA.title,
    description: ALTA_VALIDA.description,
    category: ALTA_VALIDA.category,
  }

  it('acepta contenido sin priority ni assignedToId', () => {
    const resultado = updateIncidentSchema.safeParse(PUT_VALIDO)

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      // La distincion entre "no lo mando" y "lo mando a null" es la que permite que el
      // service sepa si tiene que llamar a `app_set_incident_priority()`.
      expect(resultado.data.priority).toBeUndefined()
      expect(resultado.data.assignedToId).toBeUndefined()
    }
  })

  it('exige title, description y category porque el PUT es de reemplazo', () => {
    for (const falta of ['title', 'description', 'category'] as const) {
      const cuerpo: Record<string, unknown> = { ...PUT_VALIDO }
      delete cuerpo[falta]

      expect(updateIncidentSchema.safeParse(cuerpo).success, `sin ${falta}`).toBe(false)
    }
  })

  it('acepta assignedToId a null para desasignar', () => {
    const resultado = updateIncidentSchema.safeParse({ ...PUT_VALIDO, assignedToId: null })

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.assignedToId).toBeNull()
    }
  })

  it('distingue assignedToId ausente de assignedToId null', () => {
    // Si los dos se vieran igual, el service no podria saber si hay que desasignar o
    // si es que el cliente no quiere tocar el campo. Zod materializa esa distincion en
    // las CLAVES del objeto, no en el valor: la clave ni esta cuando el campo no se
    // manda. Por eso el assert mira `Object.keys` y no solo el valor.
    const ausente = updateIncidentSchema.safeParse(PUT_VALIDO)
    const nulo = updateIncidentSchema.safeParse({ ...PUT_VALIDO, assignedToId: null })

    expect(ausente.success).toBe(true)
    expect(ausente.success && Object.keys(ausente.data)).not.toContain('assignedToId')
    expect(ausente.success && ausente.data.assignedToId).toBeUndefined()
    expect(nulo.success && nulo.data.assignedToId).toBeNull()
  })

  it('rechaza un assignedToId que no es un UUID', () => {
    for (const malo of ['', 'no-es-uuid', '123', '11111111-1111-4111-8111-11111111111']) {
      expect(
        updateIncidentSchema.safeParse({ ...PUT_VALIDO, assignedToId: malo }).success,
        `con assignedToId ${JSON.stringify(malo)}`,
      ).toBe(false)
    }
  })

  it('rechaza status, porque el estado tiene su propia ruta', () => {
    expect(updateIncidentSchema.safeParse({ ...PUT_VALIDO, status: 'RESOLVED' }).success).toBe(false)
  })

  it('no acepta reporterId ni needsReview', () => {
    expect(
      updateIncidentSchema.safeParse({ ...PUT_VALIDO, reporterId: '11111111-1111-4111-8111-111111111111' })
        .success,
    ).toBe(false)
    expect(updateIncidentSchema.safeParse({ ...PUT_VALIDO, needsReview: false }).success).toBe(false)
  })
})

describe('transitionIncidentSchema', () => {
  it('acepta los cuatro estados', () => {
    for (const status of ESTADOS_VALIDOS) {
      expect(transitionIncidentSchema.safeParse({ status }).success, `con ${status}`).toBe(true)
    }
  })

  it('rechaza un estado que no existe', () => {
    for (const status of ['CERRADA', 'open', 'REOPENED', '']) {
      expect(transitionIncidentSchema.safeParse({ status }).success, `con ${status}`).toBe(false)
    }
  })

  it('rechaza un segundo campo, que seria un cambio de otra cosa', () => {
    expect(transitionIncidentSchema.safeParse({ status: 'OPEN', priority: 'HIGH' }).success).toBe(false)
    expect(transitionIncidentSchema.safeParse({ priority: 'HIGH' }).success).toBe(false)
    expect(transitionIncidentSchema.safeParse({}).success).toBe(false)
  })
})

describe('createCommentSchema', () => {
  it('acepta un cuerpo de 1 a 2000 caracteres', () => {
    expect(createCommentSchema.safeParse({ body: 'a' }).success).toBe(true)
    expect(createCommentSchema.safeParse({ body: 'a'.repeat(2000) }).success).toBe(true)
  })

  it('rechaza el cuerpo vacio o de mas de 2000', () => {
    // El vacio es el unico lado del CHECK que choca con algo de este modulo: un
    // comentario de "" no tiene sentido y el CHECK lo prohibe con 23514.
    expect(createCommentSchema.safeParse({ body: '' }).success).toBe(false)
    expect(createCommentSchema.safeParse({ body: '   ' }).success).toBe(false)
    expect(createCommentSchema.safeParse({ body: 'a'.repeat(2001) }).success).toBe(false)
    expect(createCommentSchema.safeParse({}).success).toBe(false)
  })

  it('no acepta authorId, porque el autor es el actor', () => {
    expect(
      createCommentSchema.safeParse({ body: 'hola', authorId: '11111111-1111-4111-8111-111111111111' })
        .success,
    ).toBe(false)
  })
})

describe('listQuerySchema', () => {
  it('acepta un listado sin filtros', () => {
    const resultado = listQuerySchema.safeParse({})

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.page).toBeUndefined()
      expect(resultado.data.limit).toBeUndefined()
    }
  })

  it('convierte page y limit de texto a numero', () => {
    // Llega siempre como texto desde la query string, y sin `z.coerce.number()`
    // seria un 400 en un filtro que el cliente ha escrito bien.
    const resultado = listQuerySchema.safeParse({ page: '2', limit: '50' })

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.page).toBe(2)
      expect(resultado.data.limit).toBe(50)
    }
  })

  it('rechaza page 0 y page con letra', () => {
    // page=abc con `z.coerce.number()` daria NaN, y un `offset` NaN es un error de
    // Postgres que no parece de validacion.
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
    expect(listQuerySchema.safeParse({ status: 'CERRADA' }).success).toBe(false)
    expect(listQuerySchema.safeParse({ priority: 'URGENTE' }).success).toBe(false)
    expect(listQuerySchema.safeParse({ category: 'ASCENSOR' }).success).toBe(false)
  })

  it('acota q a 100 caracteres y rechaza el vacio', () => {
    expect(listQuerySchema.safeParse({ q: 'ascensor' }).success).toBe(true)
    expect(listQuerySchema.safeParse({ q: 'a'.repeat(100) }).success).toBe(true)
    expect(listQuerySchema.safeParse({ q: 'a'.repeat(101) }).success).toBe(false)
    // `q=` en la barra de direcciones llega como cadena vacia y no es una busqueda.
    expect(listQuerySchema.safeParse({ q: '' }).success).toBe(false)
    expect(listQuerySchema.safeParse({ q: '   ' }).success).toBe(false)
  })

  it('rechaza una clave desconocida', () => {
    expect(listQuerySchema.safeParse({ communityId: '11111111-1111-4111-8111-111111111111' }).success).toBe(false)
  })
})

describe('uuidSchema', () => {
  it('acepta un UUID con las dos caja', () => {
    const id = '11111111-1111-4111-8111-111111111111'

    expect(uuidSchema.safeParse(id).success).toBe(true)
    expect(uuidSchema.safeParse(id.toUpperCase()).success).toBe(true)
  })

  it('rechaza lo que no es un UUID', () => {
    for (const malo of ['', 'abc', '1', '11111111-1111-4111-8111-11111111111', '11111111111141118111111111111111']) {
      expect(uuidSchema.safeParse(malo).success, `con ${JSON.stringify(malo)}`).toBe(false)
    }
  })
})