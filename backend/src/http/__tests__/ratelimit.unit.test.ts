// ---------------------------------------------------------------------------
// Regresion del rate limit global.
//
// El bug que cubre: el `skip` comparaba `req.path === '/health'`, pero la ruta
// real es `/api/v1/health`. En un middleware de nivel de app, `req.path` es el
// path COMPLETO, asi que la comparacion no coincidia nunca y el health si
// consumia presupuesto del limite global. Medido: la peticion 301 al health
// devolvia 429, y un sondeo de balanceador mas frecuente de cada 3 segundos
// (300 por 15 minutos) se quedaba sin instancia sana.
//
// Es un test unitario y no de integracion a proposito: no toca la base de datos,
// solo express y el limiter. Va con limite 3 en lugar de 300 porque lo que se
// comprueba es la exencion, no la cifra, y 3 peticiones tardan milisegundos.
// ---------------------------------------------------------------------------

import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApiRateLimiter, HEALTH_PATH, UNLIMITED_PATHS } from '../ratelimit.js'

const LIMIT = 3

/** App minima con el limite global montado y dos rutas: el health y otra. */
function appWithGlobalLimit() {
  const app = express()
  app.use(createApiRateLimiter(LIMIT))
  app.get(HEALTH_PATH, (_req, res) => {
    res.json({ ok: true })
  })
  app.get('/api/v1/otra', (_req, res) => {
    res.json({ ok: true })
  })
  return app
}

describe('rate limit global', () => {
  it('declara el health con su path COMPLETO', () => {
    // La regresion concreta: '/health' no es '/api/v1/health', y con el path
    // corto el `skip` no excluye nada.
    expect(UNLIMITED_PATHS.has('/api/v1/health')).toBe(true)
    expect(UNLIMITED_PATHS.has('/health')).toBe(false)
    expect(HEALTH_PATH).toBe('/api/v1/health')
  })

  it('limita de verdad una ruta normal', async () => {
    // Control: sin esto, el test siguiente pasaria tambien si el limiter no
    // estuviera montado.
    const app = appWithGlobalLimit()

    const statuses: number[] = []
    for (let i = 0; i < LIMIT + 1; i++) {
      statuses.push((await request(app).get('/api/v1/otra')).status)
    }

    expect(statuses.slice(0, LIMIT).every((s) => s === 200)).toBe(true)
    expect(statuses[LIMIT]).toBe(429)
  })

  it('no cuenta el health contra el limite', async () => {
    const app = appWithGlobalLimit()

    // Primero se agota el presupuesto con una ruta normal, para que cualquier
    // efecto del health sobre el contador sea visible despues.
    for (let i = 0; i < LIMIT + 1; i++) {
      await request(app).get('/api/v1/otra')
    }

    const statuses: number[] = []
    for (let i = 0; i < LIMIT + 2; i++) {
      statuses.push((await request(app).get(HEALTH_PATH)).status)
    }

    expect(statuses.every((s) => s === 200)).toBe(true)
  })
})
