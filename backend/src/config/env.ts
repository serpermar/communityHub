// ---------------------------------------------------------------------------
// Validacion del entorno al arrancar.
//
// Falla rapido y con un mensaje util: si el .env esta mal, el proceso no llega
// a levantar el servidor. Es preferible a descubrir a mitad de un test que
// JWT_SECRET son 12 caracteres.
//
// El punto que mas culpa tiene es el check de DATABASE_URL. Conectar con el
// rol `postgres` en vez de con `app_runtime` NO da ningun error visible: la
// aplicacion funciona, las consultas responden, y cada vecino ve los datos de
// las demas comunidades porque ese rol tiene BYPASSRLS. Un fallo silencioso que
// deshace todo el aislamiento, asi que se comprueba aqui en lugar de
// confiar en que alguien lee la documentacion.
// ---------------------------------------------------------------------------

import 'dotenv/config'
import { z } from 'zod'

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())))

const int = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max)

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(1, 65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Base de datos
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),

  // Opcional a proposito: la aplicacion en runtime no la usa, y ningun modulo
  // de product la importa. Exigirla aqui haria fallar el arranque de un servidor
  // que funciona perfectamente.
  //
  // `min(1)` junto a un default de '' era contradictorio: ausente pasaba (el
  // default no se revalida) y presente-pero-vacia fallaba, de modo que el mismo
  // valor se aceptaba o se rechazaba dependiendode como hubiera llegado.
  //
  // Quien la necesita de verdad comprueba ella misma y explica que falta:
  // db-admin.ts (fixtures y seed) y check-db.ts.
  MIGRATION_DATABASE_URL: z
    .string()
    .default('')
    .describe('Solo para db pull, seed y fixtures de los tests. Nunca la usa el servidor.'),

  // JWT y sesiones
  JWT_SECRET: z.string().min(32, 'JWT_SECRET necesita al menos 32 caracteres'),
  ACCESS_TOKEN_TTL_SECONDS: int(60, 86_400).default(900),
  REFRESH_TOKEN_TTL_DAYS: int(1, 365).default(30),

  // Argon2id
  ARGON2_MEMORY_COST: int(8_192, 262_144).default(65_536),
  ARGON2_TIME_COST: int(1, 10).default(3),
  ARGON2_PARALLELISM: int(1, 16).default(4),

  // Cookie de refresh
  REFRESH_COOKIE_NAME: z.string().default('refresh_token'),
  REFRESH_COOKIE_PATH: z.string().default('/api/v1/auth'),
  REFRESH_COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('strict'),
  REFRESH_COOKIE_SECURE: booleanish.default(true),

  // Red
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  TRUST_PROXY: booleanish.default(false),

  // Rate limiting
  LOGIN_RATE_LIMIT_MAX: int(1, 1_000).default(5),
  LOGIN_RATE_LIMIT_WINDOW_MS: int(1_000, 3_600_000).default(900_000),

  // IA: opcional. Sin ellas la app funciona igual.
  GROQ_API_KEY: z.string().default(''),
  GEMINI_API_KEY: z.string().default(''),
})

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(raiz)'}: ${i.message}`)
    .join('\n')
  throw new Error(`Configuracion de entorno invalida:\n${issues}`)
}

const raw = parsed.data

// --- Guarda de seguridad: el rol de la aplicacion ----------------------------
//
// `postgres` tiene BYPASSRLS y `app_runtime` no. Con el primero, todo el
// aislamiento entre comunidades desaparece sin fallar. Se acepta el rol
// app_runtime y, en produccion, nada mas.
//
// Supavisor escribe el usuario como `app_runtime.PROJECT_REF`, y el proyecto
// local como `app_runtime`, asi que se admiten las dos formas.
const dbUser = decodeURIComponent(new URL(raw.DATABASE_URL).username)

if (!/^app_runtime(\..+)?$/.test(dbUser)) {
  throw new Error(
    [
      'DATABASE_URL debe usar el rol app_runtime, no el rol postgres.',
      `Detectado: ${dbUser || '(sin usuario en la URL)'}`,
      '',
      'Con el rol postgres la aplicacion funciona y devuelve datos de otras',
      'comunidades, porque postgres tiene BYPASSRLS y las politicas no se aplican.',
      'MIGRATION_DATABASE_URL es la que debe usar postgres, y solo para',
      'db pull y seed.',
    ].join('\n'),
  )
}

if (/:6543\//.test(raw.DATABASE_URL)) {
  throw new Error(
    [
      'DATABASE_URL debe apuntar al puerto 5432 (Session pooler), no al 6543.',
      '',
      'El pooler en modo transaccion (6543) pierde el contexto de RLS: cada',
      'sentencia se ejecuta en una transaccion distinta, asi que el SET LOCAL',
      'de app.current_user_id ya no esta cuando se evalua la politica.',
    ].join('\n'),
  )
}

if (!/sslmode=require/.test(raw.DATABASE_URL)) {
  throw new Error('DATABASE_URL necesita sslmode=require')
}

if (raw.NODE_ENV === 'production' && raw.REFRESH_COOKIE_SAMESITE !== 'strict') {
  throw new Error(
    'En produccion REFRESH_COOKIE_SAMESITE debe ser strict. Con lax o none, el refresh token viaja en peticiones de terceros.',
  )
}

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
} as const

export type Env = typeof env