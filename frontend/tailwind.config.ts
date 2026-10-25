import type { Config } from 'tailwindcss'

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
        },
        // Tokens semánticos de estado: una sola fuente para los colores que hoy
        // cada página elegía a mano (ver `src/components/ui/status.ts`).
        success: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
          950: '#022c22',
        },
        warning: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
          950: '#451a03',
        },
        danger: {
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d',
          950: '#450a0a',
        },
        info: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
          950: '#082f49',
        },
        // `accent` (violeta) cierra la escala semántica: hoy `Badge` usaba
        // `violet-*` crudo para la pata que no tenía token propio.
        accent: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
          950: '#2e1065',
        },
      },
      // Tokens semánticos: una sola fuente para los colores de superficie que
      // hoy se escribían a mano como `bg-white dark:bg-slate-900`, etc.
      backgroundColor: {
        surface: 'rgb(255 255 255)',
        'surface-muted': 'rgb(241 245 249)',
      },
      // Escala tipográfica con nombre: evita repetir `text-xl font-semibold` por
      // página. `page-title` es el `h1` de `PageHeader`.
      fontSize: {
        'page-title': ['1.25rem', { lineHeight: '1.75rem', fontWeight: '600' }],
        'section-title': ['0.875rem', { lineHeight: '1.25rem', fontWeight: '600' }],
        'meta': ['0.75rem', { lineHeight: '1rem' }],
      },
      // Radios por nivel de componente: control (inputs/botones), card (tarjetas)
      // y overlay (modales/desplegables), para que no se elijan al azar.
      borderRadius: {
        control: '0.375rem',
        card: '0.5rem',
        overlay: '0.75rem',
      },
      // Sombras por nivel: `card` para tarjetas, `overlay` para flotantes.
      boxShadow: {
        card: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        overlay: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
      },
      // Animaciones propias y mínimas (sin `tailwindcss-animate`). Se usan siempre
      // bajo `motion-safe:` para respetar `prefers-reduced-motion`.
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.98)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(12px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'fade-in-up': 'fade-in-up 200ms ease-out',
        'scale-in': 'scale-in 150ms ease-out',
        'slide-in-right': 'slide-in-right 200ms ease-out',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'in-out-soft': 'cubic-bezier(0.25, 0.8, 0.25, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config
