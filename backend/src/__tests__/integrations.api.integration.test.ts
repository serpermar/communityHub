// ---------------------------------------------------------------------------
// APIs externas por API: weather, map y geocode (spec 12 §14).
//
// El proveedor de verdad NUNCA entra aqui: se inyecta un fake guionizado con
// `setWeatherProvider`/`setGeocodingProvider` (EXT-5, EXT-13), asi que la suite
// pasa sin red. Los fixtures se siembran con `admin` y se afirma por la API, la
// regla de siempre (sembrar con privilegio, afirmar con restriccion).
//
// Lo que solo se puede demostrar aqui, y no en los unitarios:
//
//   1. La degradacion cruza todo el stack HTTP: proveedor caido -> 200, no 5xx
//      (EXT-2, criterio 4).
//   2. La cache persiste en `external_cache` de una peticion a la siguiente
//      dentro del TTL, y el proveedor deja de llamarse (criterio 5).
//   3. `geocode` escribe coordenadas de verdad y deja la fila de auditoria
//      `community.geocode` (EXT-10, EXT-14, criterio 8).
//   4. El aislamiento por comunidad (C-8) vale para los tres endpoints.
//
// La cache es COMPARTIDA entre comunidades (misma coordenada redondeada = misma
// clave, §5.2), asi que el teardown la vacia: sin eso, un test heredaria la
// entrada fresca de otro y el fake no se llamaria.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { admin } from '../db-admin.js'
import { ExternalProviderError } from '../integrations/errors.js'
import { FakeGeocodingProvider } from '../integrations/map/fake.js'
import { resetProviders, setGeocodingProvider, setWeatherProvider } from '../integrations/providers.js'
import type { PlaceView } from '../integrations/types.js'
import { FakeWeatherProvider, defaultReading } from '../integrations/weather/fake.js'
import { app, createUser, deleteCommunity, deleteUser, makeCommunity, makeMember, type TestUser } from './helpers.js'

const V1 = '/api/v1'

const usuarios: string[] = []
const comunidades: string[] = []

/**
 * Limpia las filas de auditoria de este fixture.
 *
 * `audit_logs` es append-only por trigger y sus FKs a users/communities son
 * `on delete set null`: al borrar el fixture, la accion de FK intentaria un
 * UPDATE que el trigger rechaza. `geocode` deja una fila, asi que el teardown
 * necesita el mismo rodeo que el test de IA.
 */
async function purgarAuditoria(where: { communityId?: string; actorId?: string }): Promise<void> {
  const columna = where.communityId ? 'community_id' : 'actor_id'
  const valor = where.communityId ?? where.actorId
  if (!valor) return

  await admin.$executeRawUnsafe('alter table audit_logs disable trigger audit_logs_no_update')
  try {
    await admin.$executeRawUnsafe(`delete from audit_logs where ${columna} = $1::uuid`, valor)
  } finally {
    await admin.$executeRawUnsafe('alter table audit_logs enable trigger audit_logs_no_update')
  }
}

/** La cache es compartida entre comunidades; se vacia para que cada test parta limpio. */
async function purgarCache(): Promise<void> {
  await admin.$executeRawUnsafe('delete from external_cache')
}

beforeAll(async () => {
  await purgarCache()
})

afterEach(async () => {
  resetProviders()
  await purgarCache().catch(() => undefined)
  while (comunidades.length > 0) {
    const id = comunidades.pop()!
    await purgarAuditoria({ communityId: id }).catch(() => undefined)
    await deleteCommunity(id).catch(() => undefined)
  }
})

afterAll(async () => {
  while (usuarios.length > 0) {
    const id = usuarios.pop()!
    await purgarAuditoria({ actorId: id }).catch(() => undefined)
    await deleteUser(id).catch(() => undefined)
  }
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function nuevoUsuario(fullName: string): Promise<TestUser> {
  const user = await createUser({ fullName })
  usuarios.push(user.id)
  return user
}

async function nuevaComunidad(nombre = 'Comunidad Externa'): Promise<string> {
  const id = await makeCommunity(nombre)
  comunidades.push(id)
  return id
}

async function tokenDe(user: TestUser): Promise<string> {
  const res = await request(app()).post(`${V1}/auth/login`).send({ email: user.email, password: user.password })
  expect(res.status).toBe(200)
  return `Bearer ${res.body.data.accessToken}`
}

type Actor = TestUser & { token: string }

async function miembro(comunidad: string, role: 'NEIGHBOR' | 'PROVIDER' | 'ADMIN' | 'PRESIDENT'): Promise<Actor> {
  const user = await nuevoUsuario(`Actor ${role}`)
  await makeMember(user.id, comunidad, role)
  return { ...user, token: await tokenDe(user) }
}

async function outsider(): Promise<Actor> {
  const user = await nuevoUsuario('De fuera')
  return { ...user, token: await tokenDe(user) }
}

function weather(c: string, a?: Actor): request.Test {
  const req = request(app()).get(`${V1}/communities/${c}/weather`)
  return a ? req.set('Authorization', a.token) : req
}

function map(c: string, a: Actor): request.Test {
  return request(app()).get(`${V1}/communities/${c}/map`).set('Authorization', a.token)
}

function geocode(c: string, a: Actor): request.Test {
  return request(app()).post(`${V1}/communities/${c}/geocode`).set('Authorization', a.token)
}

function place(over: Partial<PlaceView> = {}): PlaceView {
  return {
    name: 'Sitio',
    category: 'Otro',
    osmKey: 'x',
    osmValue: 'y',
    latitude: 41.6488,
    longitude: -0.8891,
    distanceM: 10,
    address: null,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// 1. Meteorologia: DTO, autenticacion y aislamiento
// ---------------------------------------------------------------------------

describe('GET /communities/:id/weather', () => {
  it('devuelve el WeatherView normalizado para un miembro', async () => {
    const c = await nuevaComunidad()
    const vecino = await miembro(c, 'NEIGHBOR')
    setWeatherProvider(new FakeWeatherProvider([defaultReading()]))

    const res = await weather(c, vecino)

    expect(res.status).toBe(200)
    expect(res.body.data.location).toMatchObject({ city: 'Zaragoza', timezone: 'Europe/Madrid' })
    expect(res.body.data.current).toMatchObject({ temperatureC: 21, condition: 'CLEAR', isDay: true })
    expect(res.body.data.today).toMatchObject({ minC: 14, maxC: 24 })
    expect(res.body.meta).toMatchObject({ cached: false, stale: false, degraded: false })
  })

  it('sin token da 401', async () => {
    const c = await nuevaComunidad()
    expect((await weather(c)).status).toBe(401)
  })

  it('a un miembro de otra comunidad le da 403', async () => {
    const c = await nuevaComunidad()
    const deFuera = await outsider()
    setWeatherProvider(new FakeWeatherProvider([defaultReading()]))
    expect((await weather(c, deFuera)).status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// 2-4. Degradacion, sin coordenadas y cache
// ---------------------------------------------------------------------------

describe('degradacion de weather', () => {
  it('sin coordenadas devuelve 200 con data null y NO_LOCATION', async () => {
    const c = await nuevaComunidad()
    const vecino = await miembro(c, 'NEIGHBOR')
    await admin.communities.update({ where: { id: c }, data: { latitude: null, longitude: null } })
    const fake = new FakeWeatherProvider([defaultReading()])
    setWeatherProvider(fake)

    const res = await weather(c, vecino)

    expect(res.status).toBe(200)
    expect(res.body.data).toBeNull()
    expect(res.body.meta.reason).toBe('NO_LOCATION')
    expect(fake.calls).toHaveLength(0)
  })

  it('con el proveedor caido y sin cache degrada con PROVIDER_ERROR (nunca 5xx)', async () => {
    const c = await nuevaComunidad()
    const vecino = await miembro(c, 'NEIGHBOR')
    setWeatherProvider(new FakeWeatherProvider(() => { throw new ExternalProviderError('caido') }))

    const res = await weather(c, vecino)

    expect(res.status).toBe(200)
    expect(res.body.data).toBeNull()
    expect(res.body.meta).toMatchObject({ degraded: true, reason: 'PROVIDER_ERROR' })
  })

  it('la segunda peticion la sirve la cache y el proveedor se llama una sola vez', async () => {
    const c = await nuevaComunidad()
    const vecino = await miembro(c, 'NEIGHBOR')
    const fake = new FakeWeatherProvider([defaultReading()])
    setWeatherProvider(fake)

    const primera = await weather(c, vecino)
    const segunda = await weather(c, vecino)

    expect(primera.status).toBe(200)
    expect(primera.body.meta.cached).toBe(false)
    expect(segunda.status).toBe(200)
    expect(segunda.body.meta.cached).toBe(true)
    expect(fake.calls).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 5-6. Mapa
// ---------------------------------------------------------------------------

describe('GET /communities/:id/map', () => {
  it('separa proveedores y puntos de interes y ordena por distancia', async () => {
    const c = await nuevaComunidad()
    const vecino = await miembro(c, 'NEIGHBOR')
    setGeocodingProvider(
      new FakeGeocodingProvider({
        searchNearby: () => [
          place({ name: 'Ferretería', category: 'Ferretería', osmKey: 'shop', osmValue: 'hardware', distanceM: 30 }),
          place({ name: 'Parque', category: 'Parque', osmKey: 'leisure', osmValue: 'park', distanceM: 120 }),
        ],
      }),
    )

    const res = await map(c, vecino)

    expect(res.status).toBe(200)
    expect(res.body.data.location).toMatchObject({ city: 'Zaragoza', latitude: 41.6488 })
    expect(res.body.data.providers.map((p: PlaceView) => p.name)).toEqual(['Ferretería'])
    expect(res.body.data.pois.map((p: PlaceView) => p.name)).toEqual(['Parque'])
  })

  it('con el proveedor caido mantiene location y deja las listas vacias', async () => {
    const c = await nuevaComunidad()
    const vecino = await miembro(c, 'NEIGHBOR')
    setGeocodingProvider(new FakeGeocodingProvider({ searchNearby: () => { throw new ExternalProviderError('caido') } }))

    const res = await map(c, vecino)

    expect(res.status).toBe(200)
    expect(res.body.data.location.city).toBe('Zaragoza')
    expect(res.body.data.providers).toEqual([])
    expect(res.body.data.pois).toEqual([])
    expect(res.body.meta).toMatchObject({ degraded: true, reason: 'PROVIDER_ERROR' })
  })
})

// ---------------------------------------------------------------------------
// 7-8. Geocodificado
// ---------------------------------------------------------------------------

describe('POST /communities/:id/geocode', () => {
  it('un ADMIN obtiene 200, se escriben las coordenadas y se audita', async () => {
    const c = await nuevaComunidad()
    const admin_ = await miembro(c, 'ADMIN')
    setGeocodingProvider(
      new FakeGeocodingProvider({
        geocode: () => ({ latitude: 40.4168, longitude: -3.7038, formattedAddress: 'Calle de Prueba 1, Zaragoza, ES', source: 'fake' }),
      }),
    )

    const res = await geocode(c, admin_)

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ latitude: 40.4168, longitude: -3.7038, source: 'fake' })

    const fila = await admin.communities.findUnique({ where: { id: c }, select: { latitude: true, longitude: true } })
    expect(Number(fila?.latitude)).toBeCloseTo(40.4168, 5)
    expect(Number(fila?.longitude)).toBeCloseTo(-3.7038, 5)

    const auditoria = await admin.$queryRawUnsafe<Array<{ action: string }>>(
      `select action from audit_logs where community_id = $1::uuid and action = 'community.geocode'`,
      c,
    )
    expect(auditoria).toHaveLength(1)
  })

  it('un no-ADMIN recibe 403', async () => {
    const c = await nuevaComunidad()
    const vecino = await miembro(c, 'NEIGHBOR')
    expect((await geocode(c, vecino)).status).toBe(403)
  })

  it('si la direccion no resuelve da 422 GEOCODING_FAILED', async () => {
    const c = await nuevaComunidad()
    const admin_ = await miembro(c, 'ADMIN')
    setGeocodingProvider(new FakeGeocodingProvider({ geocode: () => null }))

    const res = await geocode(c, admin_)

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('GEOCODING_FAILED')
  })

  it('si el proveedor cae da 502 EXTERNAL_PROVIDER_ERROR', async () => {
    const c = await nuevaComunidad()
    const admin_ = await miembro(c, 'ADMIN')
    setGeocodingProvider(new FakeGeocodingProvider({ geocode: () => { throw new ExternalProviderError('caido') } }))

    const res = await geocode(c, admin_)

    expect(res.status).toBe(502)
    expect(res.body.error.code).toBe('EXTERNAL_PROVIDER_ERROR')
  })
})

// ---------------------------------------------------------------------------
// 9. Integraciones apagadas
// ---------------------------------------------------------------------------

describe('EXTERNAL_APIS_ENABLED=false', () => {
  it('weather y map degradan con DISABLED y geocode da 503', async () => {
    const c = await nuevaComunidad()
    const admin_ = await miembro(c, 'ADMIN')
    setWeatherProvider(null)
    setGeocodingProvider(null)

    const tiempo = await weather(c, admin_)
    expect(tiempo.status).toBe(200)
    expect(tiempo.body.data).toBeNull()
    expect(tiempo.body.meta.reason).toBe('DISABLED')

    const mapa = await map(c, admin_)
    expect(mapa.status).toBe(200)
    expect(mapa.body.data.location.city).toBe('Zaragoza')
    expect(mapa.body.data.providers).toEqual([])
    expect(mapa.body.meta.reason).toBe('DISABLED')

    const geo = await geocode(c, admin_)
    expect(geo.status).toBe(503)
    expect(geo.body.error.code).toBe('EXTERNAL_NOT_CONFIGURED')
  })
})

// ---------------------------------------------------------------------------
// 10. Aislamiento entre comunidades (C-8)
// ---------------------------------------------------------------------------

describe('aislamiento entre comunidades', () => {
  it('un miembro de A no obtiene datos de B en ningun endpoint', async () => {
    const a = await nuevaComunidad('Comunidad A')
    const b = await nuevaComunidad('Comunidad B')
    const vecinoDeA = await miembro(a, 'ADMIN')
    setWeatherProvider(new FakeWeatherProvider([defaultReading()]))
    setGeocodingProvider(new FakeGeocodingProvider())

    expect((await weather(b, vecinoDeA)).status).toBe(403)
    expect((await map(b, vecinoDeA)).status).toBe(403)
    expect((await geocode(b, vecinoDeA)).status).toBe(403)
  })
})

// Un identificador aleatorio bien formado pero inexistente tambien da 403 (C-8),
// no 404: un 404 confirmaria que ese id esta libre.
describe('comunidad inexistente', () => {
  it('da 403 en weather', async () => {
    const vecino = await miembro(await nuevaComunidad(), 'NEIGHBOR')
    setWeatherProvider(new FakeWeatherProvider([defaultReading()]))
    expect((await weather(randomUUID(), vecino)).status).toBe(403)
  })
})
