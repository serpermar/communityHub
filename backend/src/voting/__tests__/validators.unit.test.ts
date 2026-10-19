// ---------------------------------------------------------------------------
// Validadores de votaciones.
//
// Tests unitarios: no abren la base de datos. Lo que se comprueba aqui es la
// FORMA de lo que entra, la unica parte del bloque que se puede comprobar sin
// PostgreSQL.
//
// Lo que importa no es que zod funcione, sino el motivo de cada regla:
//
//   - Los tres enums (`type`, `status`, `resultVisibility`) se listan, no se
//     dejan pasar como texto libre: sin la lista, `type=inventado` llegaria al
//     `::vote_type` y Postgres lo rechazaria con 22P02, que sin traduccion es un
//     500.
//   - `options` es la lista de opciones REALES (2-20), no la abstencion (V-10):
//     por eso el minimo es 2. Los duplicados NO se filtran aqui a proposito
//     (los caza `app_set_vote_options()` con su propio codigo de contrato).
//   - `endsAt > startsAt` se compara por instante, no por texto.
//   - `quorumPercent` es obligatorio con QUORUM y prohibido con SINGLE (V-9).
//   - El PATCH no lleva `.transform()` en los opcionales: un campo ausente no
//     aparece en la salida (si apareciera, vaciaria datos).
//   - `.strict()` en todos: `status`, `communityId` o `createdBy` son un 400, no
//     algo que se ignora en silencio.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import {
  ESTADOS_VALIDOS,
  TIPOS_VALIDOS,
  VISIBILIDADES_VALIDAS,
  castVoteSchema,
  createVoteSchema,
  updateVoteSchema,
  uuidSchema,
  votesQuerySchema,
} from '../validators.js'

const UUID = '11111111-1111-4111-8111-111111111111'
const OTRO_UUID = '22222222-2222-4222-8222-222222222222'

const INICIO = '2026-11-01T10:00:00Z'
const FIN = '2026-11-08T10:00:00Z'

/** Una votacion valida, para partir de aqui y romper una cosa cada vez. */
const VOTACION_VALIDA = {
  title: '¿Pintamos la fachada?',
  question: '¿Autorizas el gasto de pintar la fachada?',
  description: 'Presupuesto de 4.200 €, dos semanas de obra.',
  type: 'SINGLE' as const,
  startsAt: INICIO,
  endsAt: FIN,
  allowAbstention: true,
  resultVisibility: 'AFTER_CLOSE' as const,
  options: ['Sí', 'No'],
}

describe('createVoteSchema', () => {
  it('acepta un cuerpo valido', () => {
    expect(createVoteSchema.safeParse(VOTACION_VALIDA).success).toBe(true)
  })

  it('acepta una votacion QUORUM con su quorum', () => {
    expect(
      createVoteSchema.safeParse({ ...VOTACION_VALIDA, type: 'QUORUM', quorumPercent: 60 }).success,
    ).toBe(true)
  })

  it('exige quorumPercent cuando type es QUORUM', () => {
    expect(createVoteSchema.safeParse({ ...VOTACION_VALIDA, type: 'QUORUM' }).success).toBe(false)
    expect(
      createVoteSchema.safeParse({ ...VOTACION_VALIDA, type: 'QUORUM', quorumPercent: null })
        .success,
    ).toBe(false)
  })

  it('prohibe quorumPercent cuando NO es QUORUM', () => {
    expect(createVoteSchema.safeParse({ ...VOTACION_VALIDA, quorumPercent: 60 }).success).toBe(
      false,
    )
    expect(
      createVoteSchema.safeParse({ ...VOTACION_VALIDA, type: 'SINGLE', quorumPercent: 10 }).success,
    ).toBe(false)
  })

  it('acota quorumPercent a 1-100', () => {
    expect(
      createVoteSchema.safeParse({ ...VOTACION_VALIDA, type: 'QUORUM', quorumPercent: 1 }).success,
    ).toBe(true)
    expect(
      createVoteSchema.safeParse({ ...VOTACION_VALIDA, type: 'QUORUM', quorumPercent: 100 })
        .success,
    ).toBe(true)
    expect(
      createVoteSchema.safeParse({ ...VOTACION_VALIDA, type: 'QUORUM', quorumPercent: 0 }).success,
    ).toBe(false)
    expect(
      createVoteSchema.safeParse({ ...VOTACION_VALIDA, type: 'QUORUM', quorumPercent: 101 })
        .success,
    ).toBe(false)
    expect(
      createVoteSchema.safeParse({ ...VOTACION_VALIDA, type: 'QUORUM', quorumPercent: 60.5 })
        .success,
    ).toBe(false)
  })

  it('acepta los dos tipos y rechaza uno inventado', () => {
    for (const type of TIPOS_VALIDOS) {
      // QUORUM necesita su porcentaje (V-9); SINGLE no lo admite.
      const base =
        type === 'QUORUM'
          ? { ...VOTACION_VALIDA, type, quorumPercent: 60 }
          : { ...VOTACION_VALIDA, type }
      expect(createVoteSchema.safeParse(base).success, `con ${type}`).toBe(true)
    }
    for (const type of ['MULTIPLE', 'single', '']) {
      expect(
        createVoteSchema.safeParse({ ...VOTACION_VALIDA, type }).success,
        `con ${JSON.stringify(type)}`,
      ).toBe(false)
    }
  })

  it('acepta las tres visibilidades y rechaza una inventada', () => {
    for (const resultVisibility of VISIBILIDADES_VALIDAS) {
      expect(
        createVoteSchema.safeParse({ ...VOTACION_VALIDA, resultVisibility }).success,
        `con ${resultVisibility}`,
      ).toBe(true)
    }
    for (const resultVisibility of ['ALWAYS', 'after_close', '']) {
      expect(
        createVoteSchema.safeParse({ ...VOTACION_VALIDA, resultVisibility }).success,
        `con ${JSON.stringify(resultVisibility)}`,
      ).toBe(false)
    }
  })

  it('exige title 1-120 y question 1-200', () => {
    expect(createVoteSchema.safeParse({ ...VOTACION_VALIDA, title: '' }).success).toBe(false)
    expect(createVoteSchema.safeParse({ ...VOTACION_VALIDA, title: '   ' }).success).toBe(false)
    expect(createVoteSchema.safeParse({ ...VOTACION_VALIDA, title: 'a'.repeat(120) }).success).toBe(
      true,
    )
    expect(createVoteSchema.safeParse({ ...VOTACION_VALIDA, title: 'a'.repeat(121) }).success).toBe(
      false,
    )

    expect(createVoteSchema.safeParse({ ...VOTACION_VALIDA, question: '' }).success).toBe(false)
    expect(
      createVoteSchema.safeParse({ ...VOTACION_VALIDA, question: 'a'.repeat(200) }).success,
    ).toBe(true)
    expect(
      createVoteSchema.safeParse({ ...VOTACION_VALIDA, question: 'a'.repeat(201) }).success,
    ).toBe(false)
  })

  it('acota description a 1000 y admite vaciarla', () => {
    expect(
      createVoteSchema.safeParse({ ...VOTACION_VALIDA, description: 'a'.repeat(1000) }).success,
    ).toBe(true)
    expect(
      createVoteSchema.safeParse({ ...VOTACION_VALIDA, description: 'a'.repeat(1001) }).success,
    ).toBe(false)
    expect(createVoteSchema.safeParse({ ...VOTACION_VALIDA, description: null }).success).toBe(true)
  })

  it('exige options de 2-20 cadenas no vacias de 1-120', () => {
    expect(createVoteSchema.safeParse({ ...VOTACION_VALIDA, options: ['Solo una'] }).success).toBe(
      false,
    )
    expect(createVoteSchema.safeParse({ ...VOTACION_VALIDA, options: ['', 'No'] }).success).toBe(
      false,
    )
    expect(
      createVoteSchema.safeParse({
        ...VOTACION_VALIDA,
        options: Array.from({ length: 20 }, (_, i) => `O${i}`),
      }).success,
    ).toBe(true)
    expect(
      createVoteSchema.safeParse({
        ...VOTACION_VALIDA,
        options: Array.from({ length: 21 }, (_, i) => `O${i}`),
      }).success,
    ).toBe(false)
    expect(
      createVoteSchema.safeParse({ ...VOTACION_VALIDA, options: ['a'.repeat(120), 'No'] }).success,
    ).toBe(true)
    expect(
      createVoteSchema.safeParse({ ...VOTACION_VALIDA, options: ['a'.repeat(121), 'No'] }).success,
    ).toBe(false)
  })

  it('rechaza options como texto suelto', () => {
    expect(createVoteSchema.safeParse({ ...VOTACION_VALIDA, options: 'Sí,No' }).success).toBe(false)
  })

  it('exige endsAt posterior a startsAt', () => {
    expect(
      createVoteSchema.safeParse({ ...VOTACION_VALIDA, startsAt: FIN, endsAt: INICIO }).success,
    ).toBe(false)
    expect(
      createVoteSchema.safeParse({ ...VOTACION_VALIDA, startsAt: INICIO, endsAt: INICIO }).success,
    ).toBe(false)
  })

  it('acepta un instante con offset explicito', () => {
    expect(
      createVoteSchema.safeParse({ ...VOTACION_VALIDA, startsAt: '2026-11-01T10:00:00+02:00' })
        .success,
    ).toBe(true)
  })

  it('rechaza un instante sin zona o mal formado', () => {
    for (const malo of ['2026-11-01', '2026-11-01T10:00:00', 'ayer', '']) {
      expect(
        createVoteSchema.safeParse({ ...VOTACION_VALIDA, startsAt: malo }).success,
        `con ${malo}`,
      ).toBe(false)
    }
  })

  it('rechaza claves desconocidas (status, communityId, createdBy...)', () => {
    for (const clave of [
      'id',
      'communityId',
      'createdBy',
      'status',
      'effectiveStatus',
      'closedAt',
      'deletedAt',
      'myOptionId',
    ]) {
      expect(
        createVoteSchema.safeParse({ ...VOTACION_VALIDA, [clave]: 'lo-que-sea' }).success,
        `con la clave ${clave}`,
      ).toBe(false)
    }
  })

  it('rechaza un cuerpo vacio', () => {
    expect(createVoteSchema.safeParse({}).success).toBe(false)
  })
})

describe('updateVoteSchema', () => {
  it('acepta un PATCH con un solo campo', () => {
    expect(updateVoteSchema.safeParse({ title: 'Otro título' }).success).toBe(true)
  })

  it('rechaza un PATCH vacio', () => {
    expect(updateVoteSchema.safeParse({}).success).toBe(false)
  })

  it('no añade claves ausentes (sin .transform())', () => {
    const resultado = updateVoteSchema.safeParse({ title: 'Otro' })

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(Object.keys(resultado.data)).toEqual(['title'])
      expect('description' in resultado.data).toBe(false)
      expect('quorumPercent' in resultado.data).toBe(false)
    }
  })

  it('conserva description null explicito (vaciado)', () => {
    const resultado = updateVoteSchema.safeParse({ description: null })

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.description).toBeNull()
    }
  })

  it('solo compara fechas si el PATCH trae las dos', () => {
    expect(updateVoteSchema.safeParse({ startsAt: INICIO, endsAt: INICIO }).success).toBe(false)
    expect(updateVoteSchema.safeParse({ startsAt: FIN, endsAt: INICIO }).success).toBe(false)
    // Con una sola la funcion valida el valor fusionado: aqui no se puede decidir.
    expect(updateVoteSchema.safeParse({ endsAt: INICIO }).success).toBe(true)
  })

  it('aplica la coherencia tipo/quorum cuando el PATCH toca el tipo', () => {
    expect(updateVoteSchema.safeParse({ type: 'SINGLE', quorumPercent: 50 }).success).toBe(false)
    expect(updateVoteSchema.safeParse({ type: 'QUORUM', quorumPercent: null }).success).toBe(false)
    expect(updateVoteSchema.safeParse({ type: 'QUORUM', quorumPercent: 50 }).success).toBe(true)
  })

  it('permite quorumPercent suelto (sin type) y lo valida la funcion', () => {
    expect(updateVoteSchema.safeParse({ quorumPercent: 50 }).success).toBe(true)
  })

  it('rechaza claves desconocidas', () => {
    for (const clave of ['status', 'communityId', 'createdBy', 'closedAt']) {
      expect(updateVoteSchema.safeParse({ [clave]: 'x' }).success, `con ${clave}`).toBe(false)
    }
  })
})

describe('votesQuerySchema', () => {
  it('acepta un listado sin filtros', () => {
    const resultado = votesQuerySchema.safeParse({})

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.status).toBeUndefined()
      expect(resultado.data.page).toBeUndefined()
    }
  })

  it('acepta los tres estados y rechaza uno inventado', () => {
    for (const status of ESTADOS_VALIDOS) {
      expect(votesQuerySchema.safeParse({ status }).success, `con ${status}`).toBe(true)
    }
    for (const status of ['PAGADA', 'open', '']) {
      expect(votesQuerySchema.safeParse({ status }).success, `con ${JSON.stringify(status)}`).toBe(
        false,
      )
    }
  })

  it('convierte page y limit de texto a numero y acota limit a 100', () => {
    const resultado = votesQuerySchema.safeParse({ page: '2', limit: '50' })

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.page).toBe(2)
      expect(resultado.data.limit).toBe(50)
    }

    expect(votesQuerySchema.safeParse({ limit: '101' }).success).toBe(false)
    expect(votesQuerySchema.safeParse({ page: '0' }).success).toBe(false)
  })

  it('rechaza una clave desconocida (?q=)', () => {
    expect(votesQuerySchema.safeParse({ q: 'fachada' }).success).toBe(false)
  })
})

describe('castVoteSchema', () => {
  it('acepta un optionId con forma de UUID', () => {
    expect(castVoteSchema.safeParse({ optionId: UUID }).success).toBe(true)
  })

  it('exige optionId', () => {
    expect(castVoteSchema.safeParse({}).success).toBe(false)
    expect(castVoteSchema.safeParse({ optionId: 'no-es-uuid' }).success).toBe(false)
    expect(castVoteSchema.safeParse({ optionId: OTRO_UUID }).success).toBe(true)
  })

  it('rechaza campos extra como userId o weight', () => {
    expect(castVoteSchema.safeParse({ optionId: UUID, userId: UUID }).success).toBe(false)
    expect(castVoteSchema.safeParse({ optionId: UUID, weight: 2 }).success).toBe(false)
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
