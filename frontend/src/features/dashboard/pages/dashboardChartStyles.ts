import type { CSSProperties, SVGProps } from 'react'

/**
 * Estilos de los tooltips de Recharts. Recharts exige objetos JS en
 * `contentStyle`/`labelStyle`, así que no pueden ir en el CSS Module.
 * Los colores vienen del hook `useChartColors`, por eso se construyen
 * como funciones que reciben los colores.
 */
export function tooltipContentStyle(colors: {
  tooltipBg: string
  tooltipBorder: string
  tooltipText: string
}): CSSProperties {
  return {
    background: colors.tooltipBg,
    border: `1px solid ${colors.tooltipBorder}`,
    borderRadius: 8,
    color: colors.tooltipText,
  }
}

export function tooltipLabelStyle(colors: { tooltipText: string }): CSSProperties {
  return {
    color: colors.tooltipText,
  }
}

/**
 * Props del tick de los ejes. Recharts tipa `tick` como
 * `SVGProps<SVGTextElement>`, así que el retorno debe ser ese tipo,
 * no `CSSProperties` (que admite valores CSS modernos que no existen
 * en SVG, como `-moz-initial`).
 */
export function axisTickStyle(colors: { axis: string }): SVGProps<SVGTextElement> {
  return {
    fontSize: 11,
    fill: colors.axis,
  }
}
