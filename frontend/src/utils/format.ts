function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
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
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n)
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
