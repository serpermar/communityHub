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
      },
      // Tokens semánticos: una sola fuente para los colores de superficie que
      // hoy se escribían a mano como `bg-white dark:bg-slate-900`, etc.
      backgroundColor: {
        surface: 'rgb(255 255 255)',
        'surface-muted': 'rgb(241 245 249)',
      },
    },
  },
  plugins: [],
} satisfies Config
