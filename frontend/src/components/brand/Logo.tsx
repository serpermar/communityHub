import { cn } from '@/utils/cn'
import styles from './Logo.module.css'

/**
 * Marca de CommunityHub.
 *
 * El SVG original llevaba colores fijos (`#111827`, `#6B7280`), que sobre el
 * fondo oscuro del tema `dark` quedaban invisibles. Aqui los trazos usan
 * `currentColor`: el logo hereda el color del texto que lo rodea, asi que se ve
 * bien en claro y en oscuro sin necesidad de dos variantes.
 *
 * El texto del logotipo se pinta como HTML (no como `<text>` dentro del SVG)
 * para que use la misma tipografia que la app y respete el tema.
 */

function BrandGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 260 260"
      fill="none"
      aria-hidden="true"
      className={cn(styles.glyph, className)}
    >
      <g stroke="currentColor" strokeWidth={15} strokeLinecap="round" strokeLinejoin="round">
        <path d="M 62 208 L 62 100 L 130 44 L 198 100 L 198 134 C 198 118 184 110 170 110 L 158 110" />
        <path d="M 62 208 L 170 208" />
      </g>
      <g fill="currentColor">
        <circle cx="130" cy="104" r="10" />
      </g>
      <path d="M 130 120 L 130 193" stroke="currentColor" strokeWidth={18} strokeLinecap="round" />
      <g
        stroke="currentColor"
        strokeWidth={11}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.5}
      >
        <circle cx="98" cy="124" r="8" fill="currentColor" stroke="none" />
        <path d="M 98 138 L 98 160 Q 98 177 80 177 Q 68 177 68 164" />
        <circle cx="162" cy="124" r="8" fill="currentColor" stroke="none" />
        <path d="M 162 138 L 162 177 L 142 177" />
      </g>
    </svg>
  )
}

export function Logo({
  withText = true,
  className,
  textClassName,
}: {
  withText?: boolean
  className?: string
  textClassName?: string
}) {
  return (
    <span className={cn(styles.container, className)}>
      <BrandGlyph />
      {withText && (
        <span className={cn(styles.text, textClassName)} aria-hidden="true">
          Community<span className={styles.hubText}>Hub</span>
        </span>
      )}
      <span className={styles.srOnly}>CommunityHub</span>
    </span>
  )
}

export { BrandGlyph }
