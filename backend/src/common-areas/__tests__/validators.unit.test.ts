// ---------------------------------------------------------------------------
// Validadores de zonas comunes.
//
// Tests unitarios: no abren la base de datos. Lo que se comprueba aqui es la
// FORMA de lo que entra, que es la unica parte de este bloque que se puede
// comprobar sin Supabase.
//
// Lo que importa no es que zod funcione, sino el motivo de cada regla:
//
//   - Los ENUM se listan, no se dejan pasar como texto libre. Sin esta lista,
//     `type=inventado` llegaria al SQL y Postgres lo rechazaria con 22P02, que
//     sin traduccion es un 500.
//   - Los limites son copia de los CHECK de la tabla (`common_areas_name_length`
//     2-80, `common_areas_slot_valid` {30,60,90,120}, `common_areas_hours_valid`
//     close > open). El backend no puede leer constraints, y el unico sitio
//     donde se puede equivocar sin que nadie lo note es el que se comprueba
//     despues del otro.
//   - `.strict()` en los tres esquemas: una clave desconocida es un error, no
//     algo que se ignora en silencio. En el POST es lo que hace que mandar
//     `communityId` sea un 400 en vez de un 201 con el campo descartado.
//   - CA-4: el POST admite campos ausentes, el PUT exige los diez. Es la
//     diferencia entre reemplazo y creacion, y es lo que estos tests defienden.
//
// Lo que NO se comprueba aqui, y por que:
//
//   - Que el SQL acepte lo que zod deja pasar. Eso es de los tests de
//     integracion.
//   - Que los limites de aqui y los CHECK de ahi coincidan. Tambien de
//     integracion, porque solo ahi se puede insertar un nombre de 1 caracter y
//     ver que la base de datos lo rechaza.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import {
  REJILLAS_VALIDAS,
  TIPOS_VALIDOS,
  availabilityQuerySchema,
  createCommonAreaSchema,
  updateCommonAreaSchema,
  uuidSchema,
} from '../validators.js'

/** Un cuerpo de POST valido, para partir de aqui y romper una cosa cada vez. */
const ALTA_VALIDA = {
  name: 'Piscina comunitaria',
}

/** El PUT completo, que es lo contrario: todo presente (CA-4). */
const PUT_VALIDO = {
  name: 'Piscina comunitaria',
  type: 'SWIMMING_POOL' as const,
  description: 'Piscina climatizada de 25 metros.',
  capacity: 30,
  slotMinutes: 60,
  openTime: '08:00',
  closeTime: '22:00',
  maxDailyReservations: 20,
  requiresApproval: false,
  isActive: true,
}

describe('createCommonAreaSchema', () => {
  it('acepta un cuerpo con solo el nombre', () => {
    // Los demas campos usan el default de la columna (spec 05 7.3). Comprobarlo
    // aqui es comprobar que zod NO los rellena: si le pusiera un valor por
    // defecto, el backend y la base de datos tendrian DOS fuentes del default.
    const resultado = createCommonAreaSchema.safeParse(ALTA_VALIDA)

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.type).toBeUndefined()
      expect(resultado.data.slotMinutes).toBeUndefined()
      expect(resultado.data.openTime).toBeUndefined()
      expect(resultado.data.isActive).toBeUndefined()
    }
  })

  it('acepta un cuerpo completo', () => {
    expect(createCommonAreaSchema.safeParse(PUT_VALIDO).success).toBe(true)
  })

  it('acepta los ocho valores de type', () => {
    for (const type of TIPOS_VALIDOS) {
      expect(createCommonAreaSchema.safeParse({ ...ALTA_VALIDA, type }).success, `con type ${type}`).toBe(true)
    }
  })

  it('rechaza un type inventado', () => {
    for (const type of ['PISCINA', 'pool', 'Paddle', '']) {
      expect(createCommonAreaSchema.safeParse({ ...ALTA_VALIDA, type }).success, `con ${type}`).toBe(false)
    }
  })

  it('acepta exactamente las cuatro rejillas del CHECK', () => {
    for (const slotMinutes of REJILLAS_VALIDAS) {
      expect(
        createCommonAreaSchema.safeParse({ ...ALTA_VALIDA, slotMinutes }).success,
        `con slotMinutes ${slotMinutes}`,
      ).toBe(true)
    }
  })

  it('rechaza 45, decimales y texto en slotMinutes', () => {
    // 45 es el caso que mas importa: no es un capricho de formato, es que el
    // CHECK `common_areas_slot_valid` solo admite 30, 60, 90 y 120, y un valor
    // intermedio produciria una rejilla que no encaja con el generate_series.
    expect(createCommonAreaSchema.safeParse({ ...ALTA_VALIDA, slotMinutes: 45 }).success).toBe(false)
    expect(createCommonAreaSchema.safeParse({ ...ALTA_VALIDA, slotMinutes: 60.5 }).success).toBe(false)
    expect(createCommonAreaSchema.safeParse({ ...ALTA_VALIDA, slotMinutes: 0 }).success).toBe(false)
    expect(createCommonAreaSchema.safeParse({ ...ALTA_VALIDA, slotMinutes: '60' }).success).toBe(false)
  })

  it('aplica los mismos limites que common_areas_name_length', () => {
    // 2 y 80 son los lados del CHECK. Estan escritos aqui a mano y no
    // calculados: los numeros viven en dos sitios y por eso se duplican.
    expect(createCommonAreaSchema.safeParse({ name: 'a' }).success).toBe(false)
    expect(createCommonAreaSchema.safeParse({ name: 'ab' }).success).toBe(true)
    expect(createCommonAreaSchema.safeParse({ name: 'a'.repeat(80) }).success).toBe(true)
    expect(createCommonAreaSchema.safeParse({ name: 'a'.repeat(81) }).success).toBe(false)
  })

  it('aplica el trim antes de medir la longitud', () => {
    // Sin trim, cinco espacios serian un nombre de cinco caracteres y pasarian
    // aqui, pero el CHECK de la tabla lo mediria despues de insertar los
    // espacios.
    expect(createCommonAreaSchema.safeParse({ name: '     ' }).success).toBe(false)
  })

  it('convierte description vacia, nula y ausente en lo mismo', () => {
    const vacia = createCommonAreaSchema.safeParse({ ...ALTA_VALIDA, description: '   ' })
    const nula = createCommonAreaSchema.safeParse({ ...ALTA_VALIDA, description: null })
    const ausente = createCommonAreaSchema.safeParse(ALTA_VALIDA)

    expect(vacia.success && vacia.data.description).toBeNull()
    expect(nula.success && nula.data.description).toBeNull()
    expect(ausente.success && ausente.data.description).toBeNull()
  })

  it('acota description a 500 y capacity a >= 1 entero', () => {
    expect(
      createCommonAreaSchema.safeParse({ ...ALTA_VALIDA, description: 'a'.repeat(501) }).success,
    ).toBe(false)
    expect(
      createCommonAreaSchema.safeParse({ ...ALTA_VALIDA, description: 'a'.repeat(500) }).success,
    ).toBe(true)

    expect(createCommonAreaSchema.safeParse({ ...ALTA_VALIDA, capacity: 0 }).success).toBe(false)
    expect(createCommonAreaSchema.safeParse({ ...ALTA_VALIDA, capacity: 1.5 }).success).toBe(false)
    expect(createCommonAreaSchema.safeParse({ ...ALTA_VALIDA, capacity: 20 }).success).toBe(true)
    // null es "sin limite", no un 0 (CA-10).
    expect(createCommonAreaSchema.safeParse({ ...ALTA_VALIDA, capacity: null }).success).toBe(true)
  })

  it('rechaza communityId, que va en la URL', () => {
    const resultado = createCommonAreaSchema.safeParse({
      ...ALTA_VALIDA,
      communityId: '11111111-1111-4111-8111-111111111111',
    })

    expect(resultado.success).toBe(false)
  })

  it('rechaza claves que la base de datos pone sola', () => {
    for (const clave of ['id', 'createdBy', 'createdAt', 'updatedAt']) {
      expect(
        createCommonAreaSchema.safeParse({ ...ALTA_VALIDA, [clave]: 'lo-que-sea' }).success,
        `con la clave ${clave}`,
      ).toBe(false)
    }
  })

  it('rechaza un cuerpo vacio, porque el nombre es obligatorio', () => {
    expect(createCommonAreaSchema.safeParse({}).success).toBe(false)
  })

  it('rechaza closeTime <= openTime con el mismo criterio que el CHECK', () => {
    // 22:00 > 08:00 es valido; 08:00 == 08:00 y 07:00 < 08:00 no.
    expect(
      createCommonAreaSchema.safeParse({ ...ALTA_VALIDA, openTime: '08:00', closeTime: '22:00' }).success,
    ).toBe(true)
    expect(
      createCommonAreaSchema.safeParse({ ...ALTA_VALIDA, openTime: '08:00', closeTime: '08:00' }).success,
    ).toBe(false)
    expect(
      createCommonAreaSchema.safeParse({ ...ALTA_VALIDA, openTime: '08:00', closeTime: '07:00' }).success,
    ).toBe(false)
  })

  it('no comprueba el horario si falta uno de los dos', () => {
    // Solo cuando los DOS estan presentes: en el POST un campo ausente usa el
    // default de la columna, y el default ya cuadra.
    expect(createCommonAreaSchema.safeParse({ ...ALTA_VALIDA, openTime: '08:00' }).success).toBe(true)
    expect(createCommonAreaSchema.safeParse({ ...ALTA_VALIDA, closeTime: '22:00' }).success).toBe(true)
  })

  it('rechaza horas fuera del formato HH:MM estricto', () => {
    for (const hora of ['8:00', '24:00', '08:60', '08:0', '08h00', '']) {
      expect(
        createCommonAreaSchema.safeParse({ ...ALTA_VALIDA, openTime: hora }).success,
        `con openTime ${JSON.stringify(hora)}`,
      ).toBe(false)
    }
  })
})

describe('updateCommonAreaSchema', () => {
  it('acepta el reemplazo completo', () => {
    expect(updateCommonAreaSchema.safeParse(PUT_VALIDO).success).toBe(true)
  })

  it('exige los diez campos, porque el PUT es de reemplazo (CA-4)', () => {
    for (const falta of Object.keys(PUT_VALIDO) as Array<keyof typeof PUT_VALIDO>) {
      const cuerpo: Record<string, unknown> = { ...PUT_VALIDO }
      delete cuerpo[falta]

      expect(updateCommonAreaSchema.safeParse(cuerpo).success, `sin ${falta}`).toBe(false)
    }
  })

  it('acepta null en description, capacity y maxDailyReservations (CA-10)', () => {
    // Vaciar un limite es una operacion real, y sin `null` no tendria forma de
    // expresarse. Los otros siete campos NO admiten null: `name: null` no es un
    // nombre.
    for (const campo of ['description', 'capacity', 'maxDailyReservations'] as const) {
      const resultado = updateCommonAreaSchema.safeParse({ ...PUT_VALIDO, [campo]: null })

      expect(resultado.success, `con ${campo}: null`).toBe(true)
      if (resultado.success) {
        expect(resultado.data[campo]).toBeNull()
      }
    }

    expect(updateCommonAreaSchema.safeParse({ ...PUT_VALIDO, name: null }).success).toBe(false)
    expect(updateCommonAreaSchema.safeParse({ ...PUT_VALIDO, slotMinutes: null }).success).toBe(false)
    expect(updateCommonAreaSchema.safeParse({ ...PUT_VALIDO, openTime: null }).success).toBe(false)
    expect(updateCommonAreaSchema.safeParse({ ...PUT_VALIDO, requiresApproval: null }).success).toBe(false)
  })

  it('distingue description ausente de description null', () => {
    // Ausente = no es un PUT valido. Null = borrar la descripcion. Si zod las
    // viera igual, el PUT parcial pasaria y dejaria campos sin tocar.
    const { description: _omitida, ...sinDescription } = PUT_VALIDO

    expect(updateCommonAreaSchema.safeParse(sinDescription).success).toBe(false)
    expect(updateCommonAreaSchema.safeParse({ ...sinDescription, description: null }).success).toBe(true)
  })

  it('rechaza updated_at, porque lo pone el servidor', () => {
    expect(
      updateCommonAreaSchema.safeParse({ ...PUT_VALIDO, updatedAt: '2026-10-06T10:00:00.000Z' }).success,
    ).toBe(false)
  })

  it('rechaza un slotMinutes fuera del CHECK', () => {
    expect(updateCommonAreaSchema.safeParse({ ...PUT_VALIDO, slotMinutes: 45 }).success).toBe(false)
    expect(updateCommonAreaSchema.safeParse({ ...PUT_VALIDO, slotMinutes: 30 }).success).toBe(true)
  })

  it('rechaza closeTime <= openTime', () => {
    expect(updateCommonAreaSchema.safeParse({ ...PUT_VALIDO, openTime: '22:00', closeTime: '08:00' }).success).toBe(
      false,
    )
  })
})

describe('availabilityQuerySchema', () => {
  it('acepta una fecha valida', () => {
    const resultado = availabilityQuerySchema.safeParse({ date: '2026-10-06' })

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.date).toBe('2026-10-06')
    }
  })

  it('rechaza formatos variantes, sin normalizar', () => {
    // `2026-2-5` y `06/10/2026` son 400, no fechas que se arreglan: aceptarlos
    // haria que dos clientes pidieran "el mismo dia" y el backend resolviera
    // dias distintos.
    for (const date of ['2026-2-5', '06/10/2026', '20261006', '2026-10-06T00:00:00Z', '']) {
      expect(availabilityQuerySchema.safeParse({ date }).success, `con ${JSON.stringify(date)}`).toBe(false)
    }
  })

  it('rechaza fechas inexistentes en el calendario', () => {
    // La regex deja pasar `2026-02-31`; el `.refine` es el que la mata. Sin
    // el, Postgres rechazaria `::date` con un error poco claro.
    for (const date of ['2026-02-31', '2026-04-31', '2026-13-01', '2026-00-10']) {
      expect(availabilityQuerySchema.safeParse({ date }).success, `con ${date}`).toBe(false)
    }
  })

  it('rechaza la fecha ausente, que es obligatoria', () => {
    expect(availabilityQuerySchema.safeParse({}).success).toBe(false)
  })

  it('rechaza claves desconocidas', () => {
    expect(availabilityQuerySchema.safeParse({ date: '2026-10-06', status: 'FREE' }).success).toBe(false)
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
