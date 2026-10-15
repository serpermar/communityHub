// ---------------------------------------------------------------------------
// Validadores del dashboard (spec 13 §10.3).
//
// Unitarios: no abren la base de datos. Lo que se comprueba es la FORMA de la
// query, que es la unica parte del bloque que se puede comprobar sin PostgreSQL.
//
// El endpoint solo acepta `from` y `to`, dos fechas `YYYY-MM-DD` estrictas. Tres
// reglas y sus motivos:
//
//   - Formato y calendario: `2026-2-5` y `2026-02-31` son un 400, no fechas que
//     se arreglan. Aceptar variantes haria que dos clientes pidieran "el mismo
//     dia" y el backend resolviera dias distintos.
//   - `from <= to`: una ventana invertida no es un rango vacio, es un error de
//     quien llama.
//   - El rango no pasa de 24 meses (DSH-5): esta acotado para que nadie pida
//     una serie de veinte anios y convierta la home en una consulta pesada. El
//     limite se cuenta por meses de calendario, no por dias.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import { dashboardQuerySchema } from '../validators.js'

describe('dashboardQuerySchema', () => {
  it('acepta una query vacia (los defaults los pone la funcion de SQL)', () => {
    const resultado = dashboardQuerySchema.safeParse({})

    expect(resultado.success).toBe(true)
    if (resultado.success) {
      expect(resultado.data.from).toBeUndefined()
      expect(resultado.data.to).toBeUndefined()
    }
  })

  it('acepta solo from o solo to', () => {
    expect(dashboardQuerySchema.safeParse({ from: '2026-01-01' }).success).toBe(true)
    expect(dashboardQuerySchema.safeParse({ to: '2026-12-31' }).success).toBe(true)
  })

  it('acepta un rango valido', () => {
    expect(dashboardQuerySchema.safeParse({ from: '2026-01-01', to: '2026-12-31' }).success).toBe(true)
  })

  it('rechaza from > to', () => {
    expect(dashboardQuerySchema.safeParse({ from: '2026-12-31', to: '2026-01-01' }).success).toBe(false)
  })

  it('acepta el mismo dia', () => {
    expect(dashboardQuerySchema.safeParse({ from: '2026-06-15', to: '2026-06-15' }).success).toBe(true)
  })

  it('acepta exactamente 24 meses y rechaza 25 (DSH-5)', () => {
    expect(dashboardQuerySchema.safeParse({ from: '2024-01-01', to: '2026-01-01' }).success).toBe(true)
    expect(dashboardQuerySchema.safeParse({ from: '2024-01-01', to: '2026-02-01' }).success).toBe(false)
  })

  it('cuenta los meses por calendario, no por dias', () => {
    // 2024-01-31 -> 2026-01-30 son menos de 24 meses completos; sigue valiendo.
    expect(dashboardQuerySchema.safeParse({ from: '2024-01-31', to: '2026-01-30' }).success).toBe(true)
  })

  it('rechaza un formato de fecha que no es YYYY-MM-DD', () => {
    for (const malo of ['2026-1-5', '15/01/2026', 'ayer', '', '2026/01/15']) {
      expect(
        dashboardQuerySchema.safeParse({ from: malo }).success,
        `con ${JSON.stringify(malo)}`,
      ).toBe(false)
    }
  })

  it('rechaza una fecha que no existe en el calendario', () => {
    expect(dashboardQuerySchema.safeParse({ from: '2026-02-31' }).success).toBe(false)
    expect(dashboardQuerySchema.safeParse({ from: '2025-02-29' }).success).toBe(false)
  })

  it('rechaza una clave desconocida (?q=, ?communityId=)', () => {
    for (const clave of ['q', 'communityId', 'page', 'limit']) {
      expect(
        dashboardQuerySchema.safeParse({ [clave]: 'lo-que-sea' }).success,
        `con la clave ${clave}`,
      ).toBe(false)
    }
  })
})
