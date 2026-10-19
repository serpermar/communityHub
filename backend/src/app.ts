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
import { createCommunitiesRouter } from './communities/routes.js'
import {
  createInvitationRedeemRouter,
  createInvitationsRouter,
  createMembersRouter,
} from './members/routes.js'
import { createIncidentRouter, createIncidentsRouter } from './incidents/routes.js'
import { createCommonAreaRouter, createCommonAreasRouter } from './common-areas/routes.js'
import { createReservationRouter, createReservationsRouter } from './reservations/routes.js'
import { createAnnouncementRouter, createAnnouncementsRouter } from './announcements/routes.js'
import { createDocumentRouter, createDocumentsRouter } from './documents/routes.js'
import { createExpenseRouter, createFinanceRouter } from './finance/routes.js'
import { createVoteRouter, createVotesRouter } from './voting/routes.js'
import { createAiRouter } from './ai/routes.js'
import { createAgentsRouter } from './agents/routes.js'
import { createMcpRouter } from './mcp/routes.js'
import { createExternalRouter } from './integrations/routes.js'
import { createDashboardRouter } from './dashboard/routes.js'
import { createNotificationsRouter } from './notifications/routes.js'
import { createAiRateLimiter, createApiRateLimiter, HEALTH_PATH } from './http/ratelimit.js'
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
  // antes de que ninguna validación lo mire. Las subidas de documentos van por
  // una ruta aparte con su propio límite.
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: false, limit: '1mb' }))
  app.use(cookieParser())

  if (!env.isTest) {
    app.use((req, res, next) => {
      const started = process.hrtime.bigint()
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - started) / 1e6
        logger.info(
          { method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms) },
          'petición',
        )
      })
      next()
    })
  }

  // El limite global NO se monta en los tests de integracion.
  //
  // `helpers.app()` cachea una sola instancia para toda la suite, y el limiter
  // cuenta por IP: supertest viene siempre de 127.0.0.1, asi que las peticiones
  // de un test gastan el presupuesto de los demas. Hoy la suite queda por debajo
  // de 300 y no se nota; al anadir tests empezaria a fallar con 429 sin relacion
  // con lo que se prueba, que es la peor forma de fallar.
  //
  // El limite de login si se monta en los tests, y con su limite real, porque es
  // el que protege de verdad y hay tests que dependen de el (criterio 17). Esos
  // tests usan una app aislada para no interferir con el resto.
  if (!env.isTest) {
    app.use(createApiRateLimiter())
  }

  app.get(HEALTH_PATH, async (_req, res) => {
    try {
      await prisma.$queryRaw`select 1`

      // Se pregunta a la base de datos si la sesion actual tiene BYPASSRLS, en
      // lugar de deducirlo de la URL.
      //
      // La URL no responde a la pregunta: `app_runtime` y `postgres` se
      // distinguen por un prefijo, y ese prefijo lo elige quien escribe la
      // variable. `pg_roles` no se puede convencer con una cadena. Ademas,
      // `env.ts` ya se niega a arrancar con un rol que no sea `app_runtime`, asi
      // que la comprobacion por URL no solo era mas debil: era imposible que
      // dijera otra cosa que `true`.
      const rlsRows = await prisma.$queryRaw<Array<{ bypassrls: boolean }>>`
        select r.rolbypassrls as bypassrls from pg_roles r where r.rolname = current_user
      `

      res.status(200).json({
        data: {
          status: 'ok',
          database: 'reachable',
          // `false` aqui significa que el aislamiento NO se esta aplicando. Es el
          // unico campo del health que importa vigilar en produccion.
          rlsEnforced: rlsRows[0]?.bypassrls === false,
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
  app.use('/api/v1/communities', createCommunitiesRouter())

  // Miembros e invitaciones cuelgan del mismo prefijo que las comunidades, y van
  // en routers aparte porque son otro dominio (spec 03). El orden entre los tres
  // no importa: cada router solo atiende las rutas que declara y el que no
  // coincide pasa al siguiente.
  app.use('/api/v1/communities', createMembersRouter())
  app.use('/api/v1/communities', createInvitationsRouter())

  // El canje va aparte porque NO es una ruta de comunidad: al canjear no se sabe
  // todavia en que comunidad se entra, y la comunidad la decide el codigo (M-10).
  app.use('/api/v1/invitations', createInvitationRedeemRouter())

  // Incidencias, en dos routers porque las ocho rutas no comparten prefijo (spec 04):
  // dos llevan la comunidad en la URL y seis llevan la incidencia. El orden entre
  // routers no importa, cada uno solo atiende las suyas.
  app.use('/api/v1/communities', createIncidentsRouter())
  app.use('/api/v1', createIncidentRouter())

  // Zonas comunes (spec 05) y reservas (spec 06), tambien en dos routers cada
  // una por lo mismo: dos rutas de zona cuelgan de la comunidad y las otras dos
  // de `/api/v1`; la ruta de reservas de comunidad cuelga de la comunidad y las
  // otras cinco de `/api/v1`. Ningun orden entre routers: cada uno solo atiende
  // las suyas.
  app.use('/api/v1/communities', createCommonAreasRouter())
  app.use('/api/v1', createCommonAreaRouter())
  app.use('/api/v1/communities', createReservationsRouter())
  app.use('/api/v1', createReservationRouter())

  // Avisos (spec 07), en dos routers por lo mismo: el listado y el alta
  // cuelgan de la comunidad, el PUT y el DELETE del aviso. Ningun orden entre
  // routers: cada uno solo atiende las suyas.
  app.use('/api/v1/communities', createAnnouncementsRouter())
  app.use('/api/v1', createAnnouncementRouter())

  // Documentos (spec 08), en dos routers por lo mismo: el listado y el alta
  // cuelgan de la comunidad, el detalle/descarga/borrado del documento.
  app.use('/api/v1/communities', createDocumentsRouter())
  app.use('/api/v1', createDocumentRouter())

  // Finanzas (spec 09), en dos routers por lo mismo: las seis rutas de
  // comunidad (gastos listar/crear, facturas listar/crear/pagar, resumen)
  // cuelgan de la comunidad, las tres de gasto por id de `/api/v1`.
  app.use('/api/v1/communities', createFinanceRouter())
  app.use('/api/v1', createExpenseRouter())

  // Votaciones (spec 10), en dos routers por lo mismo: el listado y el alta
  // cuelgan de la comunidad, las siete rutas por id del voto, de `/api/v1`.
  app.use('/api/v1/communities', createVotesRouter())
  app.use('/api/v1', createVoteRouter())

  // IA (spec 11): un solo router, sin comunidad en la URL (D-1). El communityId
  // viaja en el cuerpo o en la sesion.
  //
  // El limite especifico de IA (M-11) se monta aqui y en MCP: son las dos
  // superficies que gastan tokens de un proveedor gratuito o exponen datos a un
  // agente. Se omite en tests por el mismo motivo que el global (una sola app
  // cacheada para toda la suite agotaria el contador).
  if (!env.isTest) {
    app.use('/api/v1/ai', createAiRateLimiter())
  }
  app.use('/api/v1/ai', createAiRouter())

  // Agentes (spec 16, M-10): ejecucion de agentes de runtime. Cuelgan de `/ai`
  // porque comparten el mismo dominio y el mismo contrato de comunidad-en-cuerpo.
  app.use('/api/v1/ai/agents', createAgentsRouter())

  // MCP (spec 16): servidor de tools de solo lectura para agentes externos. Solo
  // se monta si esta habilitado; el propio router responde MCP_DISABLED si no.
  if (env.MCP_ENABLED) {
    if (!env.isTest) app.use(env.MCP_HTTP_PATH, createAiRateLimiter())
    app.use(env.MCP_HTTP_PATH, createMcpRouter())
  }

  // APIs externas (spec 12): meteorologia y mapa de cada comunidad. Las tres
  // rutas cuelgan de la comunidad porque las tres necesitan sus coordenadas o
  // su direccion; no hay una cuarta a nivel de plataforma.
  app.use('/api/v1/communities', createExternalRouter())

  // Dashboard (spec 13): una sola ruta, la home de una comunidad. Cuelga de la
  // comunidad porque todos sus agregados son de esa comunidad.
  app.use('/api/v1/communities', createDashboardRouter())

  // Notificaciones (spec 14): la campana del usuario. NO cuelga de la comunidad
  // porque la lista es global por usuario (NTF-3); las cuatro rutas exigen solo
  // sesion y la RLS `notifications_own` acota cada fila a su dueno.
  app.use('/api/v1/notifications', createNotificationsRouter())

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
