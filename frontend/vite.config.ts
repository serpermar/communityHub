import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { visualizer } from 'rollup-plugin-visualizer'

// La SPA habla con el backend por el proxy /api para que la cookie de refresh
// (sameSite=strict) viaje como *same-site* tambien en desarrollo (decision FE-4).
//
// El analisis del bundle solo se genera en modo `analyze` (`npm run analyze`),
// para no ensuciar `dist/` ni ralentizar el build normal ni el de produccion.
export default defineConfig(({ mode }) => {
  const analyze = mode === 'analyze'

  return {
    plugins: [
      react(),
      ...(analyze
        ? [
            visualizer({
              filename: 'dist/stats.html',
              gzipSize: true,
              brotliSize: true,
              template: 'treemap',
            }),
          ]
        : []),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-charts': ['recharts'],
            'vendor-forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
          },
        },
      },
    },
  }
})
