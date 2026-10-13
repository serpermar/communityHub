// ---------------------------------------------------------------------------
// Validadores de finanzas.
//
// Tests unitarios: no abren la base de datos. Lo que se comprueba aqui es la
// FORMA de lo que entra, que es la unica parte de este bloque que se puede
// comprobar sin PostgreSQL.
//
// Lo que importa no es que zod funcione, sino el motivo de cada regla:
//
//   - Los ENUM (`category`, `status`) se listan, no se dejan pasar como texto
//     libre. Sin esta lista, `category=inventado` llegaria al SQL y Postgres lo
//     rechazaria con 22P02, que sin traduccion es un 500.
//   - Los limites de longitud (concept 1-120, supplier 1-200, notes 1-1000,
//     number 1-50) son copia de los CHECK que 02j_FINANCE.sql anade. El backend
//     no puede leer constraints, y el unico sitio donde se puede equivocar sin
//     que nadie lo note es el que se comprueba despues del otro.
//   - `amount` se limita a 9 999 999 999,99 (FN-9): el `numeric(12,2)` aguanta
//     exactamente eso.
//   - Las fechas van `YYYY-MM-DD` estricto y se comparan por instante, no por
//     texto (`from <= to`, `dueDate >= issueDate`).
//   - `.strict()` en todos los esquemas: `id`, `createdBy`, `status`, `paidAt` o
//     `communityId` son un 400, no algo que se ignora en silencio.
//
// Lo que NO se comprueba aqui, y por que:
//
//   - Que `invoiceId` sea de la MISMA comunidad: eso lo decide la funcion con
//     `expense_invoice_mismatch` (FN-10), que necesita la base de datos.
//   - Que el `number` de factura sea unico: es el indice unico por comunidad.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import {
  CATEGORIAS_VALIDAS,
  ESTADOS_VALIDOS,
  createInvoiceSchema,
  expenseSchema,
  expensesQuerySchema,
  invoicesQuerySchema,
  payBodySchema,
  uuidSchema,
} from '../validators.js'

const UUID = '11111111-1111-4111-8111-111111111111'

/** Un cuerpo de gasto valido, para partir de aqui y romper una cosa cada vez. */
const GASTO_VALIDO = {
  concept: 'Reparación de la bomba',
  category: 'MAINTENANCE' as const,
  amount: 1250.5,
  expenseDate: '2026-01-15',
  supplier: 'Bombeiros Zaragoza SL',
  invoiceId: null as string | null,
  notes: 'Cambio de la válvula de retención.',
}

/** Un cuerpo de factura valido. */
const FACTURA_VALIDA = {
  number: 'INV-2026-001',
  concept: 'Seguro de la comunidad',
  amount: 890.25,
  issueDate: '2026-01-10',
  dueDate: '2026-02-10',
  supplier: 'Mapfre',
}

describe('expenseSchema', () => {
  it('acepta un cuerpo valido', () => {
    expect(expenseSchema.safeParse(GASTO_VALIDO).success).toBe(true)
  })

  it('hace category, supplier, invoiceId y notes opcionales', () => {
    const resultado = expenseSchema.safeParse({
      concept: GASTO_VALIDO.concept,
      amount: GASTO_VALIDO.amount,
      expenseDate: GASTO_VALIDO.expenseDate,
    })

    expect(resultado.success).toBe(true)
    // `category` queda `undefined` (el default lo pone la funcion: 'OTHER');
    // `supplier`/`notes`/`invoiceId` se normalizan a `null`, que es "limpiar".
    if (resultado.success) {
      expect(resultado.data.category).toBeUndefined()
      expect(resultado.data.supplier).toBeNull()
      expect(resultado.data.notes).toBeNull()
      expect(resultado.data.invoiceId).toBeNull()
    }
  })

  it('acepta las siete categorias y rechaza una inventada', () => {
    for (const category of CATEGORIAS_VALIDAS) {
      expect(expenseSchema.safeParse({ ...GASTO_VALIDO, category }).success, `con ${category}`).toBe(true)
    }

    for (const category of ['LIMPIEZA', 'maintenance', 'FOOD', '']) {
      expect(expenseSchema.safeParse({ ...GASTO_VALIDO, category }).success, `con ${JSON.stringify(category)}`).toBe(false)
    }
  })

  it('exige concept y aplica los limites del CHECK (1-120)', () => {
    expect(expenseSchema.safeParse({ ...GASTO_VALIDO, concept: '' }).success).toBe(false)
    expect(expenseSchema.safeParse({ ...GASTO_VALIDO, concept: '   ' }).success).toBe(false)
    expect(expenseSchema.safeParse({ ...GASTO_VALIDO, concept: 'a'.repeat(1) }).success).toBe(true)
    expect(expenseSchema.safeParse({ ...GASTO_VALIDO, concept: 'a'.repeat(120) }).success).toBe(true)
    expect(expenseSchema.safeParse({ ...GASTO_VALIDO, concept: 'a'.repeat(121) }).success).toBe(false)
  })

  it('exige amount > 0 y <= 9 999 999 999,99 (FN-9)', () => {
    expect(expenseSchema.safeParse({ ...GASTO_VALIDO, amount: 0 }).success).toBe(false)
    expect(expenseSchema.safeParse({ ...GASTO_VALIDO, amount: -1 }).success).toBe(false)
    expect(expenseSchema.safeParse({ ...GASTO_VALIDO, amount: 0.01 }).success).toBe(true)
    expect(expenseSchema.safeParse({ ...GASTO_VALIDO, amount: 9_999_999_999.99 }).success).toBe(true)
    expect(expenseSchema.safeParse({ ...GASTO_VALIDO, amount: 10_000_000_000 }).success).toBe(false)
  })

  it('rechaza amount como texto, porque el contrato lo exige numero', () => {
    expect(expenseSchema.safeParse({ ...GASTO_VALIDO, amount: '1250.50' }).success).toBe(false)
  })

  it('exige una fecha YYYY-MM-DD real', () => {
    expect(expenseSchema.safeParse({ ...GASTO_VALIDO, expenseDate: '2026-01-15' }).success).toBe(true)
    for (const malo of ['2026-1-5', '15/01/2026', '2026-02-31', 'ayer', '']) {
      expect(expenseSchema.safeParse({ ...GASTO_VALIDO, expenseDate: malo }).success, `con ${malo}`).toBe(false)
    }
  })

  it('normaliza supplier y notes vacios a null (FN-7)', () => {
    const resultado = expenseSchema.safeParse({ ...GASTO_VALIDO, supplier: '', notes: '   ' })

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.supplier).toBeNull()
      expect(resultado.data.notes).toBeNull()
    }
  })

  it('acota supplier a 200 y notes a 1000', () => {
    expect(expenseSchema.safeParse({ ...GASTO_VALIDO, supplier: 'a'.repeat(200) }).success).toBe(true)
    expect(expenseSchema.safeParse({ ...GASTO_VALIDO, supplier: 'a'.repeat(201) }).success).toBe(false)
    expect(expenseSchema.safeParse({ ...GASTO_VALIDO, notes: 'a'.repeat(1000) }).success).toBe(true)
    expect(expenseSchema.safeParse({ ...GASTO_VALIDO, notes: 'a'.repeat(1001) }).success).toBe(false)
  })

  it('acepta invoiceId con forma de UUID y rechaza lo que no lo es', () => {
    expect(expenseSchema.safeParse({ ...GASTO_VALIDO, invoiceId: UUID }).success).toBe(true)
    expect(expenseSchema.safeParse({ ...GASTO_VALIDO, invoiceId: null }).success).toBe(true)
    expect(expenseSchema.safeParse({ ...GASTO_VALIDO, invoiceId: 'no-es-uuid' }).success).toBe(false)
  })

  it('rechaza claves desconocidas (id, createdBy, status...)', () => {
    for (const clave of ['id', 'communityId', 'createdBy', 'createdAt', 'updatedAt', 'status', 'paidAt', 'deletedAt']) {
      expect(
        expenseSchema.safeParse({ ...GASTO_VALIDO, [clave]: 'lo-que-sea' }).success,
        `con la clave ${clave}`,
      ).toBe(false)
    }
  })

  it('rechaza un cuerpo vacio', () => {
    expect(expenseSchema.safeParse({}).success).toBe(false)
  })
})

describe('createInvoiceSchema', () => {
  it('acepta un cuerpo valido', () => {
    expect(createInvoiceSchema.safeParse(FACTURA_VALIDA).success).toBe(true)
  })

  it('exige number y lo acota a 1-50', () => {
    expect(createInvoiceSchema.safeParse({ ...FACTURA_VALIDA, number: '' }).success).toBe(false)
    expect(createInvoiceSchema.safeParse({ ...FACTURA_VALIDA, number: '   ' }).success).toBe(false)
    expect(createInvoiceSchema.safeParse({ ...FACTURA_VALIDA, number: 'a'.repeat(50) }).success).toBe(true)
    expect(createInvoiceSchema.safeParse({ ...FACTURA_VALIDA, number: 'a'.repeat(51) }).success).toBe(false)
    expect(createInvoiceSchema.safeParse({ ...FACTURA_VALIDA, number: undefined }).success).toBe(false)
  })

  it('exige amount > 0', () => {
    expect(createInvoiceSchema.safeParse({ ...FACTURA_VALIDA, amount: 0 }).success).toBe(false)
    expect(createInvoiceSchema.safeParse({ ...FACTURA_VALIDA, amount: 890.25 }).success).toBe(true)
  })

  it('rechaza dueDate anterior a issueDate', () => {
    expect(createInvoiceSchema.safeParse({ ...FACTURA_VALIDA, issueDate: '2026-02-10', dueDate: '2026-02-09' }).success).toBe(false)
    // El mismo dia es valido (due >= issue).
    expect(createInvoiceSchema.safeParse({ ...FACTURA_VALIDA, issueDate: '2026-02-10', dueDate: '2026-02-10' }).success).toBe(true)
    expect(createInvoiceSchema.safeParse({ ...FACTURA_VALIDA, dueDate: '2026-01-01' }).success).toBe(false)
  })

  it('hace concept y supplier opcionales, y normaliza el vacio a null', () => {
    const resultado = createInvoiceSchema.safeParse({ ...FACTURA_VALIDA, concept: '', supplier: '' })

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.concept).toBeNull()
      expect(resultado.data.supplier).toBeNull()
    }
  })

  it('rechaza claves desconocidas (status, paidAt, isGenerated...)', () => {
    for (const clave of ['status', 'paidAt', 'isGenerated', 'id', 'communityId', 'effectiveStatus']) {
      expect(
        createInvoiceSchema.safeParse({ ...FACTURA_VALIDA, [clave]: 'lo-que-sea' }).success,
        `con la clave ${clave}`,
      ).toBe(false)
    }
  })
})

describe('expensesQuerySchema', () => {
  it('acepta un listado sin filtros', () => {
    const resultado = expensesQuerySchema.safeParse({})

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.page).toBeUndefined()
      expect(resultado.data.limit).toBeUndefined()
      expect(resultado.data.category).toBeUndefined()
    }
  })

  it('convierte page y limit de texto a numero', () => {
    const resultado = expensesQuerySchema.safeParse({ page: '2', limit: '50' })

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.page).toBe(2)
      expect(resultado.data.limit).toBe(50)
    }
  })

  it('valida category como enum y rechaza una inventada', () => {
    expect(expensesQuerySchema.safeParse({ category: 'CLEANING' }).success).toBe(true)
    for (const category of ['LIMPIEZA', 'cleaning', '']) {
      expect(expensesQuerySchema.safeParse({ category }).success, `con ${JSON.stringify(category)}`).toBe(false)
    }
  })

  it('exige from <= to', () => {
    expect(expensesQuerySchema.safeParse({ from: '2026-01-01', to: '2026-12-31' }).success).toBe(true)
    expect(expensesQuerySchema.safeParse({ from: '2026-12-31', to: '2026-01-01' }).success).toBe(false)
  })

  it('rechaza una clave desconocida (?q=)', () => {
    expect(expensesQuerySchema.safeParse({ q: 'ascensor' }).success).toBe(false)
  })
})

describe('invoicesQuerySchema', () => {
  it('acepta un listado sin filtros', () => {
    expect(invoicesQuerySchema.safeParse({}).success).toBe(true)
  })

  it('acepta los cuatro estados, incluido OVERDUE (FN-14)', () => {
    for (const status of ESTADOS_VALIDOS) {
      expect(invoicesQuerySchema.safeParse({ status }).success, `con ${status}`).toBe(true)
    }
    expect(ESTADOS_VALIDOS).toContain('OVERDUE')
  })

  it('rechaza un estado inventado', () => {
    for (const status of ['PAGADA', 'pending', 'DUE', '']) {
      expect(invoicesQuerySchema.safeParse({ status }).success, `con ${JSON.stringify(status)}`).toBe(false)
    }
  })

  it('rechaza una clave desconocida', () => {
    expect(invoicesQuerySchema.safeParse({ number: 'INV-2026-001' }).success).toBe(false)
  })
})

describe('payBodySchema', () => {
  it('acepta un cuerpo vacio', () => {
    expect(payBodySchema.safeParse({}).success).toBe(true)
  })

  it('rechaza cualquier campo', () => {
    expect(payBodySchema.safeParse({ amount: 10 }).success).toBe(false)
    expect(payBodySchema.safeParse({ status: 'PAID' }).success).toBe(false)
  })
})

describe('uuidSchema', () => {
  it('acepta un UUID con las dos cajas', () => {
    expect(uuidSchema.safeParse(UUID).success).toBe(true)
    expect(uuidSchema.safeParse(UUID.toUpperCase()).success).toBe(true)
  })

  it('rechaza lo que no es un UUID', () => {
    for (const malo of ['', 'abc', '1', '11111111-1111-4111-8111-11111111111', '11111111111141118111111111111111']) {
      expect(uuidSchema.safeParse(malo).success, `con ${JSON.stringify(malo)}`).toBe(false)
    }
  })
})