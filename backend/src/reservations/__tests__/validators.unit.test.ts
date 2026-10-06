// ---------------------------------------------------------------------------
// Validadores de reservas.
//
// Tests unitarios: no abren la base de datos. Lo que se comprueba aqui es la
// FORMA de lo que entra.
//
// Lo que importa no es que zod funcione, sino el motivo de cada regla:
//
//   - R-2: `status`, `userId` y `communityId` NO se aceptan en el POST. El
//     primero lo decide `requires_approval` de la zona dentro de la funcion,
//     y los otros dos los ponen la sesion y la ruta. Con `.strict()` mandarlos
//     es un 400 explicito en vez de un 201 en el que se ignoran.
//   - `endsAt > startsAt` se comprueba por INSTANTE y no por cadena: dos ISO
//     con offsets distintos ("+02:00" y "Z") se ordenarian mal por texto.
//   - Los filtros de listado validan el enum `status` porque llegan como texto
//     a la query y un valor inventado llegaria al `::reservation_status` como
//     22P02, que sin traduccion es un 500.
//   - `page`/`limit` con `z.coerce`: llegan SIEMPRE como texto de la query
//     string, y sin coercion `page=2` seria un 400 en un filtro bien escrito.
//
// Lo que NO se comprueba aqui, y por que:
//
//   - Que el SQL acepte lo que zod deja pasar. Eso es de los tests de
//     integracion: el solape de slots, el limite diario y la rejilla solo
//     existen en la transaccion.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import {
  ESTADOS_VALIDOS,
  createReservationSchema,
  emptyBodySchema,
  listQuerySchema,
  meQuerySchema,
  uuidSchema,
} from '../validators.js'

/** Un cuerpo de POST valido, para partir de aqui y romper una cosa cada vez. */
const ALTA_VALIDA = {
  startsAt: '2026-10-10T10:00:00.000Z',
  endsAt: '2026-10-10T11:00:00.000Z',
}

describe('createReservationSchema', () => {
  it('acepta un cuerpo valido', () => {
    expect(createReservationSchema.safeParse(ALTA_VALIDA).success).toBe(true)
  })

  it('acepta los dos formatos de instante: Z y offset explicito', () => {
    // Valencia puede mandar `+02:00` y eso es un instante valido. Lo que NO se
    // acepta es un texto que no sea un instante, porque llegaria al
    // `::timestamptz` como 22P02.
    expect(
      createReservationSchema.safeParse({
        startsAt: '2026-10-10T10:00:00+02:00',
        endsAt: '2026-10-10T11:00:00+02:00',
      }).success,
    ).toBe(true)
    expect(
      createReservationSchema.safeParse({
        startsAt: '2026-10-10T08:00:00Z',
        endsAt: '2026-10-10T09:00:00Z',
      }).success,
    ).toBe(true)
  })

  it('rechaza textos que no son instantes ISO', () => {
    for (const startsAt of ['2026-10-10', '10/10/2026 10:00', '2026-10-10T10:00', 'mañana', '']) {
      expect(
        createReservationSchema.safeParse({ startsAt, endsAt: ALTA_VALIDA.endsAt }).success,
        `con startsAt ${JSON.stringify(startsAt)}`,
      ).toBe(false)
    }
  })

  it('rechaza endsAt <= startsAt, con el mismo criterio que la funcion (R-7)', () => {
    // La funcion lo repite dentro de la transaccion; esta es la capa que da el
    // 400 con el nombre del campo.
    expect(
      createReservationSchema.safeParse({
        startsAt: '2026-10-10T11:00:00Z',
        endsAt: '2026-10-10T10:00:00Z',
      }).success,
    ).toBe(false)

    // Igualdad tambien: un hueco de cero duraria un instante y encajaria en
    // cualquier slot.
    expect(
      createReservationSchema.safeParse({
        startsAt: '2026-10-10T10:00:00Z',
        endsAt: '2026-10-10T10:00:00Z',
      }).success,
    ).toBe(false)
  })

  it('compara por instante y no por cadena', () => {
    // Mismo instante escrito con offsets distintos. Por texto "+02:00" > "Z" a
    // igualidad de prefijo, y la comparacion por cadena daria un falso ok o un
    // falso error segun el orden.
    const resultado = createReservationSchema.safeParse({
      startsAt: '2026-10-10T10:00:00+02:00',
      endsAt: '2026-10-10T08:30:00Z',
    })

    // 08:30Z es 10:30+02:00, asi que termina media hora DESPUES: valido.
    expect(resultado.success).toBe(true)
  })

  it('hace attendees opcional y >= 1 entero', () => {
    expect(createReservationSchema.safeParse(ALTA_VALIDA).success).toBe(true)

    expect(createReservationSchema.safeParse({ ...ALTA_VALIDA, attendees: 1 }).success).toBe(true)
    expect(createReservationSchema.safeParse({ ...ALTA_VALIDA, attendees: 0 }).success).toBe(false)
    expect(createReservationSchema.safeParse({ ...ALTA_VALIDA, attendees: -1 }).success).toBe(false)
    expect(createReservationSchema.safeParse({ ...ALTA_VALIDA, attendees: 2.5 }).success).toBe(false)
    expect(createReservationSchema.safeParse({ ...ALTA_VALIDA, attendees: '4' }).success).toBe(false)
  })

  it('acota notes a 1000 y convierte vacio y null en null (R-11)', () => {
    expect(createReservationSchema.safeParse({ ...ALTA_VALIDA, notes: 'a'.repeat(1000) }).success).toBe(true)
    expect(createReservationSchema.safeParse({ ...ALTA_VALIDA, notes: 'a'.repeat(1001) }).success).toBe(false)

    const vacia = createReservationSchema.safeParse({ ...ALTA_VALIDA, notes: '   ' })
    const nula = createReservationSchema.safeParse({ ...ALTA_VALIDA, notes: null })
    const ausente = createReservationSchema.safeParse(ALTA_VALIDA)

    expect(vacia.success && vacia.data.notes).toBeNull()
    expect(nula.success && nula.data.notes).toBeNull()
    expect(ausente.success && ausente.data.notes).toBeNull()
  })

  it('rechaza status, porque lo decide requires_approval (R-2)', () => {
    // El caso que mas importa: si se aceptara, el cliente creeria que ha puesto
    // la reserva en CONFIRMED y la funcion la crearia PENDING igualmente — o
    // peor, algun dia se respetaria y R-2 dejaria de cumplirse.
    for (const status of ['CONFIRMED', 'PENDING', 'CANCELLED']) {
      expect(
        createReservationSchema.safeParse({ ...ALTA_VALIDA, status }).success,
        `con status ${status}`,
      ).toBe(false)
    }
  })

  it('rechaza userId y communityId, que ponen la sesion y la ruta (R-6)', () => {
    expect(
      createReservationSchema.safeParse({
        ...ALTA_VALIDA,
        userId: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(false)
    expect(
      createReservationSchema.safeParse({
        ...ALTA_VALIDA,
        communityId: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(false)
    expect(
      createReservationSchema.safeParse({
        ...ALTA_VALIDA,
        commonAreaId: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(false)
  })

  it('rechaza cualquier clave desconocida', () => {
    for (const clave of ['id', 'createdAt', 'notesHtml', 'cancelledAt']) {
      expect(
        createReservationSchema.safeParse({ ...ALTA_VALIDA, [clave]: 'lo-que-sea' }).success,
        `con la clave ${clave}`,
      ).toBe(false)
    }
  })

  it('rechaza un cuerpo vacio, porque faltan los instantes', () => {
    expect(createReservationSchema.safeParse({}).success).toBe(false)
  })
})

describe('emptyBodySchema', () => {
  it('acepta un objeto vacio', () => {
    expect(emptyBodySchema.safeParse({}).success).toBe(true)
  })

  it('rechaza un cuerpo con campos', () => {
    // Cancelar o confirmar es una operacion sin parametros: `{status}` seria un
    // 400 explicito en vez de un 200 que ignora el campo y deja al cliente con
    // la impresion de que ha funcionado.
    expect(emptyBodySchema.safeParse({ status: 'CANCELLED' }).success).toBe(false)
    expect(emptyBodySchema.safeParse({ reason: 'me pico' }).success).toBe(false)
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
    const resultado = listQuerySchema.safeParse({ page: '2', limit: '50' })

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.page).toBe(2)
      expect(resultado.data.limit).toBe(50)
    }
  })

  it('rechaza page 0 y page con letra', () => {
    // page=abc con `z.coerce.number()` daria NaN, y un `offset` NaN es un
    // error de Postgres que no parece de validacion.
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
    // Sin la lista, `status=inventado` llegaria al `::reservation_status` como
    // texto y Postgres lo rechazaria con 22P02, que es un 500 sin traduccion.
    for (const status of ['CONFIRMADA', 'confirmed', '']) {
      expect(listQuerySchema.safeParse({ status }).success, `con ${status}`).toBe(false)
    }
    for (const status of ESTADOS_VALIDOS) {
      expect(listQuerySchema.safeParse({ status }).success, `con ${status}`).toBe(true)
    }
  })

  it('rechaza un commonAreaId que no es UUID', () => {
    expect(listQuerySchema.safeParse({ commonAreaId: 'no-es-uuid' }).success).toBe(false)
    expect(
      listQuerySchema.safeParse({ commonAreaId: '11111111-1111-4111-8111-111111111111' }).success,
    ).toBe(true)
  })

  it('rechaza un date con formato flojo', () => {
    // Mismo criterio que la disponibilidad: sin normalizar.
    expect(listQuerySchema.safeParse({ date: '2026-10-06' }).success).toBe(true)
    expect(listQuerySchema.safeParse({ date: '2026-6-10' }).success).toBe(false)
    expect(listQuerySchema.safeParse({ date: '2026-02-31' }).success).toBe(false)
  })

  it('rechaza una clave desconocida', () => {
    expect(listQuerySchema.safeParse({ userId: '11111111-1111-4111-8111-111111111111' }).success).toBe(false)
  })
})

describe('meQuerySchema', () => {
  it('acepta solo status y paginacion', () => {
    expect(meQuerySchema.safeParse({}).success).toBe(true)
    expect(meQuerySchema.safeParse({ status: 'CONFIRMED', page: '3', limit: '10' }).success).toBe(true)
  })

  it('no acepta los filtros de comunidad', () => {
    // El ambito es el usuario y la agenda propia cruza comunidades: filtrar por
    // una zona de una comunidad concreta no tendria sentido sin comunidad en la
    // ruta.
    expect(meQuerySchema.safeParse({ commonAreaId: '11111111-1111-4111-8111-111111111111' }).success).toBe(false)
    expect(meQuerySchema.safeParse({ date: '2026-10-06' }).success).toBe(false)
  })

  it('rechaza un estado inventado', () => {
    expect(meQuerySchema.safeParse({ status: 'ARCHIVADA' }).success).toBe(false)
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
