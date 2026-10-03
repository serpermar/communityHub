import { defineConfig } from 'vitest/config'

// ---------------------------------------------------------------------------
// Configuracion de los tests UNITARIOS.
//
// Son los que no tocan la base de datos: hashing, JWT, validadores. Arrancan sin
// .env, sin red y sin Supabase, en menos de un segundo.
//
// La separacion no es cosmetica. Antes de dividirla, un fallo de configuracion
// de DATABASE_URL hacia fallar hasta el test de argon2, que no tiene nada que ver
// con la base de datos: el fallo mas proximo posible se perdia detras del mas
// ruidoso.
//
// Arriba hay una configuracion fija en lugar de leer .env a proposito. Estos tests
// no abren conexion, asi que solo necesitan que config/env.ts valide el FORMATO
// de la URL. Que el usuario sea app_runtime, el puerto 5432 y sslmode=require son
// las tres guardas de seguridad que ese modulo aplica, y aqui se cumplen sin
// necesitar el archivo real.
// ---------------------------------------------------------------------------

export default defineConfig({
  test: {
    name: 'unit',
    globals: true,
    environment: 'node',

    include: ['src/**/*.unit.test.ts'],

    env: {
      // URL que NO conecta con nada. Si algun test unitario intentara abrir
      // conexion, fallaria con un error de DNS, que es justo lo que debe pasar:
      // un test unitario que necesita la base de datos no es unitario.
      DATABASE_URL:
        'postgresql://app_runtime.sin_conexion:sin-usar@localhost:5432/postgres?sslmode=require',
      MIGRATION_DATABASE_URL: '',
      JWT_SECRET: 'secreto-de-pruebas-solo-unitarios-32chars-minimo',
      NODE_ENV: 'test',
    },

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
