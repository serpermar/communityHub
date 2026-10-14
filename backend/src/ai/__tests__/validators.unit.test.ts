// ---------------------------------------------------------------------------
// Validacion de entrada de IA (unitarios).
//
// Comprueban el BORDE: que forma tiene lo que entra por la API antes de tocar
// servicios o base de datos. Lo propio de este bloque:
//
//   - `proposal` es un objeto con enums y una `confidence` numerica; un
//     `needsHumanReview` no booleano se rechaza.
//   - El chat NO admite `userId` ni `role`: salen de la sesion, no del cuerpo.
//   - `confirm` acepta todos los campos vacios (es un parche) pero, si vienen,
//     el titulo y la descripcion ya cumplen los minimos de `incidents`.
//   - Todas las formas son `.strict()`: una clave de mas es un 400.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import {
  chatBodySchema,
  classifyBodySchema,
  confirmBodySchema,
  draftBodySchema,
  paginationQuerySchema,
  previewBodySchema,
  proposalSchema,
} from '../validators.js'

const UUID = '11111111-1111-4111-8111-111111111111'

const proposal = {
  category: 'PLUMBING',
  priority: 'HIGH',
  title: 'Fuga en el baño',
  description: 'Hay una fuga de agua en el baño del portal.',
  confidence: 0.8,
  needsHumanReview: false,
}

describe('proposalSchema', () => {
  it('acepta una propuesta bien formada', () => {
    expect(proposalSchema.safeParse(proposal).success).toBe(true)
  })

  it('rechaza una categoria que no es del enum', () => {
    expect(proposalSchema.safeParse({ ...proposal, category: 'FONTANERIA' }).success).toBe(false)
  })

  it('rechaza una prioridad que no es del enum', () => {
    expect(proposalSchema.safeParse({ ...proposal, priority: 'URGENT' }).success).toBe(false)
  })

  it('exige que needsHumanReview sea booleano', () => {
    expect(proposalSchema.safeParse({ ...proposal, needsHumanReview: 'si' }).success).toBe(false)
  })

  it('acota la confianza a [0, 1]', () => {
    expect(proposalSchema.safeParse({ ...proposal, confidence: 1.5 }).success).toBe(false)
    expect(proposalSchema.safeParse({ ...proposal, confidence: -0.1 }).success).toBe(false)
    expect(proposalSchema.safeParse({ ...proposal, confidence: 0.5 }).success).toBe(true)
  })

  it('rechaza un titulo por debajo de 3 caracteres', () => {
    expect(proposalSchema.safeParse({ ...proposal, title: 'ab' }).success).toBe(false)
  })

  it('rechaza una clave de mas', () => {
    expect(proposalSchema.safeParse({ ...proposal, extra: 1 }).success).toBe(false)
  })
})

describe('chatBodySchema', () => {
  it('admite solo el mensaje', () => {
    expect(chatBodySchema.safeParse({ message: '¿Cuántos vecinos hay?' }).success).toBe(true)
  })

  it('rechaza un cuerpo sin mensaje', () => {
    expect(chatBodySchema.safeParse({}).success).toBe(false)
  })

  it('rechaza un mensaje vacio', () => {
    expect(chatBodySchema.safeParse({ message: '   ' }).success).toBe(false)
  })

  it('rechaza un sessionId que no es UUID', () => {
    expect(chatBodySchema.safeParse({ message: 'hola', sessionId: 'no-uuid' }).success).toBe(false)
  })

  it('NO admite userId ni role en el cuerpo', () => {
    expect(chatBodySchema.safeParse({ message: 'hola', userId: 'x' }).success).toBe(false)
    expect(chatBodySchema.safeParse({ message: 'hola', role: 'ADMIN' }).success).toBe(false)
  })
})

describe('classifyBodySchema', () => {
  it('exige comunidad y descripcion', () => {
    expect(classifyBodySchema.safeParse({ communityId: 'x', description: 'hola' }).success).toBe(false)
    expect(
      classifyBodySchema.safeParse({ communityId: '11111111-1111-4111-8111-111111111111', description: 'hola' })
        .success,
    ).toBe(true)
  })

  it('rechaza una descripcion de menos de 3 caracteres', () => {
    expect(
      classifyBodySchema.safeParse({ communityId: '11111111-1111-4111-8111-111111111111', description: 'ab' })
        .success,
    ).toBe(false)
  })
})

describe('draftBodySchema', () => {
  it('la propuesta es opcional', () => {
    expect(
      draftBodySchema.safeParse({
        communityId: '11111111-1111-4111-8111-111111111111',
        description: 'No hay agua caliente',
      }).success,
    ).toBe(true)
  })

  it('si viene, se valida como el proposal', () => {
    expect(
      draftBodySchema.safeParse({
        communityId: '11111111-1111-4111-8111-111111111111',
        description: 'No hay agua caliente',
        proposal: { category: 'OTHER' },
      }).success,
    ).toBe(false)
  })
})

describe('confirmBodySchema', () => {
  it('acepta un cuerpo vacio', () => {
    expect(confirmBodySchema.safeParse({}).success).toBe(true)
  })

  it('acepta un parche parcial', () => {
    expect(confirmBodySchema.safeParse({ title: 'Nuevo título' }).success).toBe(true)
  })

  it('aplica los minimos de incidents al titulo y la descripcion', () => {
    expect(confirmBodySchema.safeParse({ title: 'abcd' }).success).toBe(false)
    expect(confirmBodySchema.safeParse({ description: 'corta' }).success).toBe(false)
  })

  it('rechaza un estado o un campo de mas (no se transiciona por aqui)', () => {
    expect(confirmBodySchema.safeParse({ status: 'RESOLVED' }).success).toBe(false)
  })
})

describe('previewBodySchema', () => {
  it('por defecto los args son un objeto vacio', () => {
    const parsed = previewBodySchema.parse({ communityId: '11111111-1111-4111-8111-111111111111' })
    expect(parsed.args).toEqual({})
  })

  it('exige communityId', () => {
    expect(previewBodySchema.safeParse({ args: {} }).success).toBe(false)
  })
})

describe('paginationQuerySchema', () => {
  it('acepta page y limit opcionales', () => {
    expect(paginationQuerySchema.safeParse({}).success).toBe(true)
    expect(paginationQuerySchema.safeParse({ page: '2', limit: '10' }).success).toBe(true)
  })

  it('rechaza page 0 y limit no entero', () => {
    expect(paginationQuerySchema.safeParse({ page: '0' }).success).toBe(false)
    expect(paginationQuerySchema.safeParse({ limit: 'x' }).success).toBe(false)
  })
})
