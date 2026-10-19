import { es, type Dictionary } from './es'

// ---------------------------------------------------------------------------
// Traduccion minima del shell de la SPA.
//
// Hoy solo hay un idioma (castellano). `t` acepta una ruta con puntos
// (`t('nav.dashboard')`) y devuelve el texto del catalogo. Anadir otro idioma es
// ampliar `DICTIONARIES` y `locale`; no cambia la firma usada por los
// componentes.
// ---------------------------------------------------------------------------

export type Locale = 'es'

const DICTIONARIES: Record<Locale, Dictionary> = { es }

let locale: Locale = 'es'

export function setLocale(next: Locale): void {
  locale = next
}

export function getLocale(): Locale {
  return locale
}

type Leaf<T> = T extends string ? string : T extends object ? { [K in keyof T]: Leaf<T[K]> } : never

const dictionary: Leaf<Dictionary> = es

export function t(path: string): string {
  const value = path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined,
      DICTIONARIES[locale],
    )
  return typeof value === 'string' ? value : path
}

export { dictionary }
