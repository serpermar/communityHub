// ---------------------------------------------------------------------------
// Bootstrap del servidor.
//
// Lo unico que hace, aparte de abrir el puerto, es el cierre ordenado. Sin el,
// al reiniciar en desarrollo se pierde la sesion de Supabase con una oleada de
// P1001.
//
// `express-async-errors` no hace falta: en Express 5 las promesas rechazadas en un
// handler async llegan solas al error handler. En Express 4 habia que involved,
// que era justo una de las razones para saltar a la 5.
// ---------------------------------------------------------------------------

import { createApp } from './app.js'
import { env } from './config/env.js'
import { logger } from './config/logger.js'
import { prisma } from './db.js'

const app = createApp()

const server = app.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV, rls: 'app_runtime (sin BYPASSRLS)' },
    `CommunityHub API escuchando en http://localhost:${env.PORT}`,
  )
})

// Cierre ordenado. Se para de aceptar conexiones, se espera a que terminen las
// que ya estan en curso y despues se cierra el pool. Al reves, las peticiones en
// vuelo mueren a mitad.
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Cerrando el servidor')

  server.close(async (err) => {
    if (err) {
      logger.error({ err }, 'Error al cerrar el servidor HTTP')
      process.exit(1)
    }

    try {
      await prisma.$disconnect()
      logger.info('Cierre ordenado completo')
      process.exit(0)
    } catch (error) {
      logger.error({ err: error }, 'Error al cerrar el pool de la base de datos')
      process.exit(1)
    }
  })

  // Si en 10 segundos no se ha cerrado todo, se fuerza. Un proceso que no
  // responde a SIGTERM no se puede desplegar bien.
  setTimeout(() => {
    logger.error('Cierre forzado tras 10s')
    process.exit(1)
  }, 10_000).unref()
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Promesa rechazada sin gestionar')
})

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Excepcion sin capturar. El proceso se detiene.')
  void shutdown('uncaughtException')
})