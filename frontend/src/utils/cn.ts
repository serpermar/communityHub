/** Une clases condicionales. Sustituye a `clsx` (no esta en el stack). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
