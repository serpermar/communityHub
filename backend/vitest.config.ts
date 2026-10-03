import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',

    // La suite comparte una única base de datos, y los tests de aislamiento
    // necesitan que no se solapen: dos ficheros escribiendo a la vez se pisan
    // los datos de prueba. `fileParallelism: false` los corre de forma
    // secuencial, que es lo que hace la suite determinista.
    fileParallelism: false,

    setupFiles: ['./src/__tests__/setup.ts'],

    include: ['src/**/*.test.ts'],

    // El test de temporización del login necesita margen para que argon2
    // ejecute su trabajo sin que un neighbouring test lo robe.
    testTimeout: 30_000,
    hookTimeout: 30_000,

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/__tests__/**', 'src/check-db.ts', 'prisma/**'],
    },
  },
})