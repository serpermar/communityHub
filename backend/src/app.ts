// ---------------------------------------------------------------------------
// Composicion de la aplicacion.
//
// Se separa de `server.ts` a proposito: `app.ts` construye la app y la devuelve,
// sin abrir un puerto. Asi los tests pueden importar `createApp()` y usar
// supertest contra la app en memoria, sin que nada escuche en un puerto y sin
// pugnas entre tests paralelos.
//
// El orden de los middleware es el que da forma a la peticion:
//   1. trust proxy      (hay que saber quien es el cliente ANTES de CORS y rates)
//   2. helmet           (cabeceras de seguridad)
//   3. cors             (si el origen no esta permitido, se corta aqui)
//   4. parsers          (cuerpo y cookies, que los handlers necesitan)
//   5. rate limit global
//   6. rutas
//   7. 404 y error handler, al final y siempre
// ---------------------------------------------------------------------------

import express, { type Express } from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { logger } from './config/logger.js'
import { env } from './config/env.js'
import { createAuthRouter } from './auth/routes.js'
import { createApiRateLimiter } from './http/ratelimit.js'
import { errorHandler, notFoundHandler } from './http/error-middleware.js'
import { prisma } from './db.js'

export function createApp(): Express {
  const app = express()

  // Detras de un proxy (Supabase, Vercel, Nginx, Cloudflare) `req.ip` sin esto
  // es la IP del proxy, y el rate limit y el registro de auditoria registrarian
  // siempre la misma direccion. En local se deja desactivado porque ahi no hay
  // proxy y ACTIVARlo haria que `req.ip` fuera undefined.
  app.set('trust proxy', env.TRUST_PROXY)
  app.disable('x-powered-by')

  app.use(
    helmet({
      // La API devuelve JSON y no sirve HTML, asi que la CSP por defecto de
      // helmet (pensada para un servidor que devuelve paginas) no encaja. Esta
      // es la equivalente para una API, y es casi restrictiva: `default-src
      // 'none'` no permite nada salvo lo que se declare.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      // El backend no sirve ficheros estáticos, asi que no puede haber un
      // directory traversal que exploitear.
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  )

  // Allowlist explicita. Una API con credenciales en cookies no puede usar
  // `origin: true`, porque eso equivale a `Access-Control-Allow-Origin` +
  // credenciales para cualquier origen.
  app.use(
    cors({
      origin(origin, callback) {
        // Sin Origin = peticion del mismo origen (curl, healthcheck, test).
        if (!origin) return callback(null, true)
        if (env.corsOrigins.includes(origin)) return callback(null, true)
        callback(new Error(`Origen no permitido por CORS: ${origin}`))
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86_400,
    }),
  )

  // `1mb` es suficiente para JSON y evita que un cuerpo enorme ocupe memoria
  // antes de que ninguna validacion lo mire. Las subidas de documentos van por
  // una ruta aparte con su propio limite.
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: false, limit: '1mb' }))
  app.use(cookieParser())

  if (!env.isTest) {
    app.use(
      (req, res, next) => {
        const started = process.hrtime.bigint()
        res.on('finish', () => {
          const ms = Number(process.hrtime.bigint() - started) / 1e6
          logger.info({ method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms) }, 'petición')
        })
        next()
      },
    )
  }

  app.use(createApiRateLimiter())

  app.get('/api/v1/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`select 1`
      res.status(200).json({
        data: {
          status: 'ok',
          database: 'reachable',
          // `app_runtime` sin BYPASSRLS es la configuracion que hace que el
          // aislamiento funcione. Si algún dia alguien conecta con `postgres`,
          // esto lo dice en voz alta.
          rlsEnforced: !env.DATABASE_URL.startsWith('postgresql://postgres.'),
          timestamp: new Date().toISOString(),
        },
      })
    } catch {
      // 503 y no 500: el proceso esta vivo, lo que falla es la base de datos.
      // Un balanceador de carga necesita distinguirlo para no mandar trafico a
      // una instancia que no puede servir.
      res.status(503).json({
        data: { status: 'degraded', database: 'unreachable', timestamp: new Date().toISOString() },
      })
    }
  })

  app.use('/api/v1/auth', createAuthRouter())

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}