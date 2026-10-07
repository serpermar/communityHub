// ---------------------------------------------------------------------------
// Validadores de avisos.
//
// Tests unitarios: no abren la base de datos. Lo que se comprueba aqui es la FORMA
// de lo que entra, que es la unica parte de este bloque que se puede comprobar sin
// Supabase.
//
// Lo que importa no es que zod funcione, sino el motivo de cada regla:
//
//   - Los ENUM (`type`, `priority`) se listan, no se dejan pasar como texto libre.
//     Sin esta lista, `type=inventado` llegaria al SQL y Postgres lo rechazaria con
//     22P02, que sin traduccion es un 500. Aqui es un 400 que ademas nombra el campo.
//   - Los limites de longitud son copia de los CHECK de `announcements_title_length`
//     (3-120) y `announcements_body_length` (1-5000). El backend no puede leer
//     constraints, y el unico sitio donde se puede equivocar sin que nadie lo note es
//     el que se comprueba despues del otro.
//   - `.strict()` en los tres esquemas: una clave desconocida es un error, no algo
//     que se ignora en silencio. En el POST es lo que hace que mandar `authorId` o
//     `communityId` sea un 400 en vez de un 201 con el campo descartado (AN-9).
//   - La ventana `expiresAt > publishAt` se compara por instante: dos ISO con
//     offsets distintos se ordenarian mal por texto, y el mismo resultado llega de
//     SQL como 23514 gracias al CHECK `announcements_dates_valid`.
//
// Lo que NO se comprueba aqui, y por que:
//
//   - Que el SQL acepte lo que zod deja pasar. Eso es de los tests de integracion.
//   - Que los limites de aqui y los CHECK de ahi coincidan. Tambien de integracion,
//     porque solo ahi se puede insertar un titulo de dos caracteres y ver que la
//     base de datos lo rechaza.
//
// La normalizacion (`trim`) se comprueba aqui porque es pura funcion de zod, y tiene
// una consecuencia que se nota mas tarde: sin el `trim`, un titulo de tres espacios
// pasaria la validacion de la aplicacion y revienta el CHECK de la tabla.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import {
  PRIORIDADES_VALIDAS,
  TIPOS_VALIDOS,
  createAnnouncementSchema,
  listQuerySchema,
  updateAnnouncementSchema,
  uuidSchema,
} from '../validators.js'

/** Un cuerpo de POST valido, para partir de aqui y romper una cosa cada vez. */
const ALTA_VALIDA = {
  title: 'Junta de vecinos de octubre',
  body: 'El jueves 8 a las 19:00 en el salón de actos. Orden del día: contabilidad y rampa.',
  type: 'MEETING' as const,
  priority: 'HIGH' as const,
  isPinned: true,
}

/** Instantes ISO validos (Z y offset explicito, los dos admitidos). */
const FUTURO = '2026-11-01T10:00:00Z'
const FUTURO_MAS_TARDI = '2026-11-02T10:00:00+02:00'
const PASADO = '2026-09-01T10:00:00+02:00'

describe('createAnnouncementSchema', () => {
  it('acepta un cuerpo valido', () => {
    expect(createAnnouncementSchema.safeParse(ALTA_VALIDA).success).toBe(true)
  })

  it('hace type, priority, isPinned, publishAt y expiresAt opcionales', () => {
    const resultado = createAnnouncementSchema.safeParse({
      title: ALTA_VALIDA.title,
      body: ALTA_VALIDA.body,
    })

    expect(resultado.success).toBe(true)
    // Quedan `undefined`, no un valor inventado. Los defaults los pone
    // `app_create_announcement()` con los mismos `coalesce` que los de la
    // columna, y si aqui se pusiera 'GENERAL' los dos sitios podrian discrepar.
    if (resultado.success) {
      expect(resultado.data.type).toBeUndefined()
      expect(resultado.data.priority).toBeUndefined()
      expect(resultado.data.isPinned).toBeUndefined()
      expect(resultado.data.publishAt).toBeUndefined()
      expect(resultado.data.expiresAt).toBeUndefined()
    }
  })

  it('acepta los cuatro valores de type y los tres de priority', () => {
    for (const type of TIPOS_VALIDOS) {
      expect(createAnnouncementSchema.safeParse({ ...ALTA_VALIDA, type }).success, `con type ${type}`).toBe(true)
    }

    for (const priority of PRIORIDADES_VALIDAS) {
      expect(
        createAnnouncementSchema.safeParse({ ...ALTA_VALIDA, priority }).success,
        `con priority ${priority}`,
      ).toBe(true)
    }
  })

  it('rechaza un enum inventado', () => {
    for (const type of ['AVISO', 'general', 'NEWS', '']) {
      expect(createAnnouncementSchema.safeParse({ ...ALTA_VALIDA, type }).success, `con type ${JSON.stringify(type)}`).toBe(
        false,
      )
    }

    for (const priority of ['URGENT', 'high', 'CRITICAL', '']) {
      expect(
        createAnnouncementSchema.safeParse({ ...ALTA_VALIDA, priority }).success,
        `con priority ${JSON.stringify(priority)}`,
      ).toBe(false)
    }
  })

  it('aplica los mismos limites que los CHECK de la tabla', () => {
    // 2 y 121 son los lados de `announcements_title_length`; 0 y 5001 los de
    // `announcements_body_length`. Estos numeros estan en los dos sitios, y por
    // eso estan escritos aqui a mano y no calculados.
    expect(createAnnouncementSchema.safeParse({ ...ALTA_VALIDA, title: 'a'.repeat(2) }).success).toBe(false)
    expect(createAnnouncementSchema.safeParse({ ...ALTA_VALIDA, title: 'a'.repeat(3) }).success).toBe(true)
    expect(createAnnouncementSchema.safeParse({ ...ALTA_VALIDA, title: 'a'.repeat(120) }).success).toBe(true)
    expect(createAnnouncementSchema.safeParse({ ...ALTA_VALIDA, title: 'a'.repeat(121) }).success).toBe(false)

    expect(createAnnouncementSchema.safeParse({ ...ALTA_VALIDA, body: '' }).success).toBe(false)
    expect(createAnnouncementSchema.safeParse({ ...ALTA_VALIDA, body: 'a'.repeat(1) }).success).toBe(true)
    expect(createAnnouncementSchema.safeParse({ ...ALTA_VALIDA, body: 'a'.repeat(5000) }).success).toBe(true)
    expect(createAnnouncementSchema.safeParse({ ...ALTA_VALIDA, body: 'a'.repeat(5001) }).success).toBe(false)
  })

  it('aplica el trim antes de medir la longitud', () => {
    // Sin trim, tres espacios serian un titulo de tres caracteres y pasarian
    // aqui, pero el CHECK de la tabla los mediria igual y no habria error —
    // hasta que el cuerpo de solo espacios si que chocaria con el minimo de 1.
    const resultado = createAnnouncementSchema.safeParse({
      ...ALTA_VALIDA,
      title: '   ',
      body: '   ',
    })

    expect(resultado.success).toBe(false)
  })

  it('acepta publishAt con Z y con offset, y rechaza texto que no es instante', () => {
    expect(createAnnouncementSchema.safeParse({ ...ALTA_VALIDA, publishAt: FUTURO }).success).toBe(true)
    expect(
      createAnnouncementSchema.safeParse({ ...ALTA_VALIDA, publishAt: '2026-11-01T11:00:00+02:00' }).success,
    ).toBe(true)

    // Sin offset y con espacio en vez de T: Postgres lo rechazaria como 22P02
    // dentro del `::timestamptz`, que sin traduccion es un 500.
    for (const malo of ['2026-11-01T10:00:00', '2026-11-01 10:00:00+02:00', 'mañana', '']) {
      expect(
        createAnnouncementSchema.safeParse({ ...ALTA_VALIDA, publishAt: malo }).success,
        `con publishAt ${JSON.stringify(malo)}`,
      ).toBe(false)
    }
  })

  it('acepta expiresAt a null, que significa "no caduca"', () => {
    const resultado = createAnnouncementSchema.safeParse({ ...ALTA_VALIDA, expiresAt: null })

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.expiresAt).toBeNull()
    }
  })

  it('rechaza expiresAt anterior o igual a publishAt cuando los dos van', () => {
    // La misma regla que el CHECK announcements_dates_valid de 02h. La
    // comparacion es por instante: FUTURO con offset "+02:00" y
    // FUTURO_MAS_TARDI con "Z" son dos horas distintas y no se ordenan bien
    // por texto.
    expect(
      createAnnouncementSchema.safeParse({ ...ALTA_VALIDA, publishAt: FUTURO, expiresAt: PASADO }).success,
    ).toBe(false)
    expect(
      createAnnouncementSchema.safeParse({
        ...ALTA_VALIDA,
        publishAt: FUTURO,
        expiresAt: FUTURO,
      }).success,
    ).toBe(false)
    expect(
      createAnnouncementSchema.safeParse({ ...ALTA_VALIDA, publishAt: FUTURO, expiresAt: FUTURO_MAS_TARDI }).success,
    ).toBe(true)
  })

  it('no compara la ventana si publishAt va ausente', () => {
    // publishAt es opcional y su default lo pone la funcion con `now()`; si
    // aqui se comparara contra nada seria inventar una fecha.
    const resultado = createAnnouncementSchema.safeParse({ ...ALTA_VALIDA, expiresAt: PASADO })

    expect(resultado.success).toBe(true)
  })

  it('no acepta authorId ni communityId, porque los pone la funcion (AN-9)', () => {
    expect(
      createAnnouncementSchema.safeParse({
        ...ALTA_VALIDA,
        authorId: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(false)
    expect(
      createAnnouncementSchema.safeParse({
        ...ALTA_VALIDA,
        communityId: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(false)
  })

  it('rechaza cualquier clave desconocida', () => {
    for (const clave of ['id', 'createdAt', 'updatedAt', 'authorName', 'deletedAt', 'pinned']) {
      expect(
        createAnnouncementSchema.safeParse({ ...ALTA_VALIDA, [clave]: 'lo-que-sea' }).success,
        `con la clave ${clave}`,
      ).toBe(false)
    }
  })

  it('rechaza un cuerpo vacio', () => {
    expect(createAnnouncementSchema.safeParse({}).success).toBe(false)
  })
})

describe('updateAnnouncementSchema', () => {
  const PUT_VALIDO = {
    title: 'Aviso reescrito',
    body: 'Cuerpo completo del aviso, reescrito de arriba abajo.',
    type: 'GENERAL' as const,
    priority: 'MEDIUM' as const,
    isPinned: false,
    publishAt: FUTURO,
    expiresAt: FUTURO_MAS_TARDI as string | null,
  }

  it('acepta los ocho campos con expiresAt presente', () => {
    expect(updateAnnouncementSchema.safeParse(PUT_VALIDO).success).toBe(true)
  })

  it('acepta expiresAt a null para deshacer una caducidad', () => {
    const resultado = updateAnnouncementSchema.safeParse({ ...PUT_VALIDO, expiresAt: null })

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.expiresAt).toBeNull()
    }
  })

  it('exige todos los campos porque el PUT es de reemplazo completo (AN-6)', () => {
    for (const falta of [
      'title',
      'body',
      'type',
      'priority',
      'isPinned',
      'publishAt',
      'expiresAt',
    ] as const) {
      const cuerpo: Record<string, unknown> = { ...PUT_VALIDO }
      delete cuerpo[falta]

      expect(updateAnnouncementSchema.safeParse(cuerpo).success, `sin ${falta}`).toBe(false)
    }
  })

  it('siempre comprueba la ventana, porque los dos campos van siempre', () => {
    expect(
      updateAnnouncementSchema.safeParse({ ...PUT_VALIDO, publishAt: FUTURO, expiresAt: PASADO }).success,
    ).toBe(false)
    expect(updateAnnouncementSchema.safeParse({ ...PUT_VALIDO, publishAt: FUTURO, expiresAt: FUTURO }).success).toBe(
      false,
    )
  })

  it('rechaza id, authorId y communityId', () => {
    // El id va en la URL y no en el cuerpo; autor y comunidad no se tocan
    // nunca en un PUT (AN-9).
    for (const clave of ['id', 'authorId', 'communityId', 'deletedAt'] as const) {
      expect(
        updateAnnouncementSchema.safeParse({
          ...PUT_VALIDO,
          [clave]: '11111111-1111-4111-8111-111111111111',
        }).success,
        `con la clave ${clave}`,
      ).toBe(false)
    }
  })

  it('rechaza status, porque un aviso no tiene estados', () => {
    expect(updateAnnouncementSchema.safeParse({ ...PUT_VALIDO, status: 'PUBLISHED' }).success).toBe(false)
  })
})

describe('listQuerySchema', () => {
  it('acepta un listado sin filtros', () => {
    const resultado = listQuerySchema.safeParse({})

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.page).toBeUndefined()
      expect(resultado.data.limit).toBeUndefined()
      expect(resultado.data.type).toBeUndefined()
      expect(resultado.data.q).toBeUndefined()
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
    // El caso de la spec §7.3: `?type=CUALQUIERA` es un 400 que nombra el
    // campo, no un 22P02 dentro del `::announcement_type`.
    for (const type of ['CUALQUIERA', 'urgent', 'GENERAL ', '']) {
      expect(listQuerySchema.safeParse({ type }).success, `con type ${JSON.stringify(type)}`).toBe(false)
    }
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
    // `?pinned=true` no es un filtro de la spec §7.3, y `.strict()` lo hace un
    // 400 en vez de un listado que lo ignora en silencio.
    expect(listQuerySchema.safeParse({ pinned: 'true' }).success).toBe(false)
    expect(listQuerySchema.safeParse({ communityId: '11111111-1111-4111-8111-111111111111' }).success).toBe(false)
  })
})

describe('uuidSchema', () => {
  it('acepta un UUID con las dos cajas', () => {
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
