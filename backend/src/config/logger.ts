// ---------------------------------------------------------------------------
// Logger estructurado.
//
// Dos motivos para no usar console.log:
//   1. Un logger de texto es dificil de consultar cuando hay que saber que
//      paso en una peticion concreta hace tres dias.
//   2. Es facil acabar escribiendo por error un token o una contrasena en una
//      linea de log, y un log no se puede "des-publicar" cuando ya ha salido
//      del proceso.
//
// El campo `redact` es la red de seguridad para lo segundo. No sustituye a no
// registrar datos sensibles: si algo llega al logger, ya ha salido del proceso
// y puede estar en un agregador de logs que nadie va a limpiar.
// ---------------------------------------------------------------------------

import pino from 'pino'
import { env } from './env.js'

export const logger = pino({
  level: env.LOG_LEVEL,
  base: undefined,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'passwordHash',
      'password_hash',
      'token',
      'refreshToken',
      'tokenHash',
      'token_hash',
      'accessToken',
      'secret',
      '*.password',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
    ],
    censor: '[redactado]',
  },
  // El test de temporizacion del login (spec 01, criterio 6) mide cuanto tarda
  // argon2. Los logs de la propia peticion falsearian la medicion.
  formatters: {
    level: (label) => ({ level: label }),
  },
  enabled: !env.isTest,
})