import { defineConfig } from 'vitest/config'

// ---------------------------------------------------------------------------
// Configuracion de los tests de INTEGRACION.
//
// Estos SI talk to la base de datos real, porque la mitad de lo que comprueban es
// que las politicas de RLS filtran de verdad. Un mock de Prisma no evalua una
// politica de Postgres: un test con mock pasaria aunque las politicas estuvieran
// rotas, que es exactamente el fallo que estos tests existen para detectar.
//
// Por eso no se salta ninguno si la base de datos no esta. Un test saltado es un
// test que no prueba nada, y un "todo verde" que en realidad no ha comprobado
// nada es peor que un fallo.
//
// Requiere backend/.env con DATABASE_URL y MIGRATION_DATABASE_URL.
// ---------------------------------------------------------------------------

export default defineConfig({
  test: {
    name: 'integration',
    globals: true,
    environment: 'node',

    // La suite comparte una unica base de datos, y los tests de aislamiento
    // necesitan que no se solapen: dos ficheros escribiendo a la vez se pisan los
    // datos de prueba. `fileParallelism: false` los corre de forma secuencial, que
    // es lo que hace la suite determinista.
    fileParallelism: false,

    setupFiles: ['./src/__tests__/integration.setup.ts'],

    include: ['src/**/*.integration.test.ts'],

    // argon2 con 64 MiB y las transacciones de RLS necesitan margen.
    testTimeout: 60_000,
    hookTimeout: 60_000,

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/__tests__/**',
        'src/check-db.ts',
        'src/db-admin.ts',
        'prisma/**',
      ],
    },
  },
})
