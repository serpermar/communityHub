/**
 * Ilustraciones ligeras para los estados vacios (FE-28).
 *
 * Son SVG en linea (sin dependencias ni peticiones) pensados para leerse en modo
 * claro y oscuro con `currentColor`. Se muestran dentro de un circulo atenuado
 * por `EmptyState`, de modo que el vacio deja de ser "solo texto".
 */
type IllustrationProps = { className?: string }

function Frame({ children, className }: IllustrationProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 48 48"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

export function EmptyBoxIcon({ className }: IllustrationProps) {
  return (
    <Frame className={className}>
      <path d="M8 16l16-7 16 7-16 7-16-7Z" />
      <path d="M8 16v16l16 7 16-7V16" />
      <path d="M24 23v16" />
    </Frame>
  )
}

export function EmptySearchIcon({ className }: IllustrationProps) {
  return (
    <Frame className={className}>
      <circle cx="21" cy="21" r="12" />
      <path d="m30 30 9 9" />
    </Frame>
  )
}

export function EmptyBellIcon({ className }: IllustrationProps) {
  return (
    <Frame className={className}>
      <path d="M28 34h8l-2.4-2.4A3 3 0 0 1 33 29.4V24a9 9 0 1 0-18 0v5.4c0 .8-.3 1.6-.9 2.2L12 34h10" />
      <path d="M20 38a4 4 0 0 0 8 0" />
    </Frame>
  )
}

export function EmptyFolderIcon({ className }: IllustrationProps) {
  return (
    <Frame className={className}>
      <path d="M8 16a3 3 0 0 1 3-3h7l4 4h15a3 3 0 0 1 3 3v15a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V16Z" />
    </Frame>
  )
}
