import { useTheme } from '@/context/ThemeContext'

/**
 * Colores para Recharts que cambian con el tema. Recharts pinta con atributos
 * `fill`/`stroke` inline, así que no hereda las clases `dark:` de Tailwind: hay
 * que darle los valores desde JS. Sin esto, en modo oscuro quedan rejillas
 * claras y texto oscuro ilegible sobre fondo oscuro.
 */
export interface ChartColors {
  grid: string
  axis: string
  tooltipBg: string
  tooltipBorder: string
  tooltipText: string
  bars: {
    incidents: string
    reservations: string
  }
  line: string
}

const LIGHT: ChartColors = {
  grid: '#e2e8f0',
  axis: '#64748b',
  tooltipBg: '#ffffff',
  tooltipBorder: '#e2e8f0',
  tooltipText: '#0f172a',
  bars: { incidents: '#2563eb', reservations: '#0ea5e9' },
  line: '#7c3aed',
}

const DARK: ChartColors = {
  grid: '#1e293b',
  axis: '#94a3b8',
  tooltipBg: '#0f172a',
  tooltipBorder: '#1e293b',
  tooltipText: '#e2e8f0',
  bars: { incidents: '#60a5fa', reservations: '#38bdf8' },
  line: '#a78bfa',
}

export function useChartColors(): ChartColors {
  const { theme } = useTheme()
  return theme === 'dark' ? DARK : LIGHT
}
