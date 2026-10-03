// ---------------------------------------------------------------------------
// Rate limiting.
//
// En memoria y por proceso. Es suficiente para una instancia unica, que es lo
// que se despliega hoy. El limite, documentado en la spec 01 (pregunta 13):
// con varias instancias cada una lleva su propio contador y el limite efectivo
// se multiplica por el numero de instancias. Cuando haga falta, se mueve el
// store a Postgres (Supabase ya esta contratado) sin cambiar la interfaz.
//
// El store se crea por instancia de la app, no como modulo global, para que los
// tests no compartan contadores entre ellos.
// ---------------------------------------------------------------------------

import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit'
import type { Request, Response } from 'express'
import { env } from '../config/env.js'

type LoginKeyRequest = Request & { body?: { email?: unknown } }

function loginKeyGenerator(req: LoginKeyRequest): string {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const ip = ipKeyGenerator(req.ip ?? '')
  // El par (email, IP) es lo que frena el ataque de fuerza bruta contra una
  // cuenta concreta. Poner solo el email permitiria bloquear la cuenta de otra
  // persona desde cualquier red; poner solo la IP no frena nada, porque el
  // atacante va cambiando de direccion.
  //
  // Sin email en el cuerpo no se puede discriminar, asi que se cae a la IP sola
  // en vez de devolver 400: el login tiene su propia validacion.
  return email ? `${ip}|${email}` : ip
}

const handler = (_req: Request, res: Response) => {
  res.status(429).json({
    error: {
      code: 'RATE_LIMITED',
      message: 'Demasiados intentos. Espera unos minutos y vuelve a probar.',
    },
  })
}

/**
 * Rutas exentas del limite global.
 *
 * `/api/v1/health` la consulta el balanceador de carga, y un 429 ahi no es
 * "abuso": es la senal que dice que la instancia esta sana. Si se limitara, un
 * sondeo frecuente (cada segundo son 900 peticiones en 15 minutos, mas del
 * limite) receberia 429 y el balanceador sacaria de rotacion una instancia
 * parfaitement sana.
 *
 * La comparacion es con el `path` COMPLETO, no con el relativo al montaje. En
 * este middleware `req.path` es `/api/v1/health`; escribir `'/health'` aqui no
 * coincide con nada y el `skip` no hace nada, que es el error que motivaba este
 * comentario. Por eso la ruta se declara como constante y se reutiliza en
 * `app.ts`.
 */
export const UNLIMITED_PATHS = new Set(['/api/v1/health'])

/** La misma ruta, para que `app.ts` no la escriba otra vez y puedan divergir. */
export const HEALTH_PATH = [...UNLIMITED_PATHS][0] as string

const common: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
  // 429 con Retry-After en draft-7 lo entiende cualquier cliente; y el header
  // ayuda al usuario a saber cuándo reintentar en lugar de picar sin parar.
  skip: (req) => UNLIMITED_PATHS.has(req.path),
}

/**
 * Limite del login: 5 intentos fallidos por (IP, email) cada 15 minutos.
 *
 * `skipSuccessfulRequests` cuenta solo los fallos. Contar tambien los exitos
 * bloquearia a un vecino que entra y sale cinco veces en cuarto de hora, que no
 * es un ataque. El limite sigue impidiendo lo que pretende impedir: probar
 * cinco contrasenas por cuenta.
 */
export function createLoginRateLimiter() {
  return rateLimit({
    ...common,
    limit: env.LOGIN_RATE_LIMIT_MAX,
    windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MS,
    keyGenerator: loginKeyGenerator as Options['keyGenerator'],
    skipSuccessfulRequests: true,
  })
}

/**
 * Limite global de la API, mas alto: protege de abuso sin molestar.
 *
 * El limite es un parametro y no una constante para que el test de regresion
 * pueda comprobar la exencion del health con 3 peticiones en lugar de 300, que
 * es lo mismo que comprobar con 300 pero en milisegundos.
 */
export function createApiRateLimiter(limit = 300) {
  return rateLimit({
    ...common,
    limit,
    windowMs: 15 * 60 * 1000,
  })
}

/** Limite de los endpoints de IA, que consumen tokens de un proveedor gratuito. */
export function createAiRateLimiter() {
  return rateLimit({
    ...common,
    limit: 20,
    windowMs: 15 * 60 * 1000,
  })
}