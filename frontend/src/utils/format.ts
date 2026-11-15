function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  // Una fecha sin hora (`YYYY-MM-DD`) se interpreta como medianoche LOCAL.
  // `new Date('2026-01-15')` la trata como UTC y en husos al oeste de UTC
  // mostraria el dia anterior.
  const dateOnly = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  const date =
    value instanceof Date ? value : dateOnly ? new Date(`${value}T00:00:00`) : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(value: string | Date | null | undefined): string {
  const date = toDate(value)
  return date
    ? date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—'
}

export function formatDateLong(value: string | Date | null | undefined): string {
  const date = toDate(value)
  return date
    ? date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—'
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value)
  return date ? date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—'
}

export function formatMoney(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = typeof value === 'string' ? Number(value) : value
  if (Number.isNaN(n)) return '—'
  // `useGrouping: true` es imprescindible: en es-ES el separador de miles solo se
  // aplica por defecto a partir de 5 digitos, asi que 2000 salia como "2000,00 €"
  // y no como "2.000,00 €".
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    useGrouping: true,
  }).format(n)
}

/** `YYYY-MM-DD` para `<input type="date">` y query params. */
export function toDateInput(value: string | Date | null | undefined): string {
  const date = toDate(value) ?? new Date()
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function humanize(value: string | null | undefined): string {
  if (!value) return '—'
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
}
