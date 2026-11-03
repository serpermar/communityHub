// ---------------------------------------------------------------------------
// Montaje de Swagger UI.
//
// Se monta ANTES del helmet global de `app.ts` porque la CSP estricta
// (`default-src 'none'`) bloquearía los scripts y estilos inline que
// swagger-ui-express inyecta en la página. La solución es darle a `/api-docs`
// su propia CSP, razonablemente estricta pero compatible con la librería, y
// dejar que la global siga aplicándose al resto de la API.
//
// swagger-ui-express sirve todos los assets desde el propio proceso (no usa
// CDN), así que `'self'` basta para scripts, estilos y fuentes. Solo se añade
// `validator.swagger.io` en `img-src` para el badge de validación de OpenAPI,
// y `'unsafe-inline'` en `script-src`/`style-src` porque swagger-ui inyecta el
// spec como JS inline en el HTML.
// ---------------------------------------------------------------------------

import { type Express } from 'express'
import helmet from 'helmet'
import swaggerUi from 'swagger-ui-express'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { swaggerSpec } from '../config/swagger.js'

export function mountSwagger(app: Express): void {
  if (!env.SWAGGER_ENABLED) {
    logger.info('Swagger desactivado (SWAGGER_ENABLED=false)')
    return
  }

  app.use(
    '/api-docs',
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https://validator.swagger.io'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customSiteTitle: 'CommunityHub API Docs',
      swaggerOptions: {
        persistAuthorization: true, // conserva el token entre recargas
        displayRequestDuration: true, // muestra los ms de cada llamada
        docExpansion: 'list', // endpoints colapsados por defecto
        filter: true, // buscador en la barra superior
        tagsSorter: 'alpha',
        tryItOutEnabled: true,
      },
    }),
  )

  // Endpoint JSON: lo consume `openapi-typescript` para generar tipos del frontend.
  app.get('/api-docs.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.send(swaggerSpec)
  })

  logger.info({ path: '/api-docs' }, 'Swagger UI disponible')
}
