import { describe, expect, it } from 'vitest'
import { formatDate, formatMoney, humanize, toDateInput } from './format'

describe('formatMoney', () => {
  it('formatea en euros', () => {
    const formatted = formatMoney(1234.5)
    expect(formatted).toContain(',5')
    expect(formatted).toContain('€')
  })

  it('acepta cadenas numéricas', () => {
    expect(formatMoney('10')).toMatch(/10,00/)
  })

  it('usa punto para los miles y coma para los decimales (es-ES)', () => {
    const formatted = formatMoney(2000.38)
    expect(formatted).toContain('2.000,38')
    expect(formatted).not.toContain('2000.38')
  })

  it('redondea a dos decimales', () => {
    expect(formatMoney(1234.567)).toContain('1.234,57')
  })

  it('devuelve guion para valores vacíos o inválidos', () => {
    expect(formatMoney(null)).toBe('—')
    expect(formatMoney('')).toBe('—')
    expect(formatMoney('abc')).toBe('—')
  })
})

describe('formatDate', () => {
  it('devuelve guion para vacío', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate('no-es-fecha')).toBe('—')
  })

  it('formatea una fecha ISO', () => {
    expect(formatDate('2026-01-15T10:00:00.000Z')).toMatch(/\d{2}\/\d{2}\/\d{4}/)
  })

  it('no desplaza las fechas sin hora al dia anterior', () => {
    expect(formatDate('2026-01-15')).toBe('15/01/2026')
  })
})

describe('toDateInput', () => {
  it('devuelve YYYY-MM-DD', () => {
    expect(toDateInput('2026-03-09T00:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('humanize', () => {
  it('capitaliza y quita guiones bajos', () => {
    expect(humanize('IN_PROGRESS')).toBe('In progress')
    expect(humanize(null)).toBe('—')
  })
})
