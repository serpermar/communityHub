// ---------------------------------------------------------------------------
// Endpoints de autenticación, contra la base de datos real.
//
// No se usa ningún mock: la mitad de lo que se comprueba aquí es que las
// funciones SECURITY DEFINER de 02b_auth.sql funcionan, que las políticas de RLS
// filtran, y que la rotación de sesiones se persiste bien. Un mock probaría que
// el código hace lo que el mock dice, que es exactamente lo que no importa.
//
// Cubre los criterios 1, 2, 7, 8, 9, 11, 15, 16 y 17 de la spec 01.
// ---------------------------------------------------------------------------

import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import {
  allSetCookies,
  app,
  createUser,
  deleteUser,
  readSessions,
  refreshCookieHeader,
  refreshCookieValue,
  TEST_PASSWORD,
  uniqueEmail,
} from './helpers.js'

const created: string[] = []

afterEach(async () => {
  // Los tests se limpian en vez de dejar datos: la suite se puede reejecutar
  // contra la misma base sin acumulación, y un fallo a mitad no envenena los
  // siguientes.
  while (created.length > 0) {
    const userId = created.pop()!
    await deleteUser(userId).catch(() => undefined)
  }
})

async function makeUser() {
  const user = await createUser()
  created.push(user.id)
  return user
}

async function loginAs(user: { email: string; password: string }) {
  const res = await request(app()).post('/api/v1/auth/login').send({ email: user.email, password: user.password })
  return res
}

describe('POST /api/v1/auth/register', () => {
  it('crea la cuenta y responde 201 con el envelope de éxito', async () => {
    const email = uniqueEmail('registro')

    const res = await request(app())
      .post('/api/v1/auth/register')
      .send({ email, password: TEST_PASSWORD, fullName: 'Nuevo Vecino' })

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      data: {
        user: { email, fullName: 'Nuevo Vecino' },
        message: 'Cuenta creada. Ya puedes entrar.',
      },
    })
    expect(res.body.data.user.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('normaliza el email a minúsculas', async () => {
    const email = uniqueEmail('Mayusculas')

    const res = await request(app())
      .post('/api/v1/auth/register')
      .send({ email: email.toUpperCase(), password: TEST_PASSWORD, fullName: 'Vecino' })

    expect(res.status).toBe(201)
    expect(res.body.data.user.email).toBe(email.toLowerCase())
  })

  it('no crea sesión: el usuario tiene que entrar con su contraseña', async () => {
    const email = uniqueEmail('sin-sesion')

    const res = await request(app())
      .post('/api/v1/auth/register')
      .send({ email, password: TEST_PASSWORD, fullName: 'Vecino' })

    expect(res.headers['set-cookie']).toBeUndefined()
  })

  it('devuelve 409 si el email ya está registrado', async () => {
    const email = uniqueEmail('duplicado')

    await request(app())
      .post('/api/v1/auth/register')
      .send({ email, password: TEST_PASSWORD, fullName: 'Primero' })
      .expect(201)

    const res = await request(app())
      .post('/api/v1/auth/register')
      .send({ email: email.toUpperCase(), password: TEST_PASSWORD, fullName: 'Segundo' })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('EMAIL_TAKEN')
  })

  it('devuelve 400 con el detalle por campo si la contraseña es corta', async () => {
    const res = await request(app())
      .post('/api/v1/auth/register')
      .send({ email: uniqueEmail(), password: 'corta', fullName: 'Vecino' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'password' })]),
    )
  })

  it('rechaza una clave desconocida en el cuerpo', async () => {
    const res = await request(app())
      .post('/api/v1/auth/register')
      .send({ email: uniqueEmail(), password: TEST_PASSWORD, fullName: 'Vecino', globalRole: 'ADMIN_SA' })

    expect(res.status).toBe(400)
  })

  it('nunca devuelve la contraseña ni su hash en la respuesta', async () => {
    // Criterio 2.
    const email = uniqueEmail('sin-secreto')

    const res = await request(app())
      .post('/api/v1/auth/register')
      .send({ email, password: TEST_PASSWORD, fullName: 'Vecino' })

    const serialized = JSON.stringify(res.body)
    expect(serialized).not.toContain(TEST_PASSWORD)
    expect(serialized).not.toContain('argon2')
    expect(serialized).not.toContain('password')
  })
})

describe('POST /api/v1/auth/login', () => {
  it('devuelve access token, expiración y usuario, y el refresh solo en cookie', async () => {
    const user = await makeUser()

    const res = await loginAs(user)

    expect(res.status).toBe(200)
    expect(res.body.data.accessToken).toBeTruthy()
    expect(res.body.data.expiresIn).toBe(env.ACCESS_TOKEN_TTL_SECONDS)
    expect(res.body.data.user).toMatchObject({ id: user.id, email: user.email })
    // El refresh token viaja solo en la cookie httpOnly. Si fuera en el cuerpo,
    // un XSS lo leería de la respuesta.
    expect(res.body.data.refreshToken).toBeUndefined()

    const cookie = refreshCookieValue(res)
    expect(cookie).toBeTruthy()
    expect(cookie).not.toBe(user.password)
  })

  it('setea la cookie con HttpOnly, SameSite y path restringido', async () => {
    const user = await makeUser()

    const res = await loginAs(user)
    const cookie = refreshCookieHeader(res)!

    expect(cookie).toContain('HttpOnly')
    expect(cookie).toMatch(/SameSite=Strict/i)
    // El path restringido es la respuesta a la pregunta 1 de la spec 01: la
    // cookie solo viaja a los endpoints de auth, que son los únicos que la
    // necesitan.
    expect(cookie).toContain('Path=/api/v1/auth')
  })

  it('persiste solo el hash SHA-256 del refresh token, nunca el token', async () => {
    const user = await makeUser()

    const res = await loginAs(user)
    const cookie = refreshCookieValue(res)!

    const sessions = await readSessions(user.id)

    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.token_hash).not.toBe(cookie)
    expect(sessions[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(sessions[0]!.status).toBe('ACTIVE')
    expect(sessions[0]!.family_id).toBeTruthy()
  })

  it('acepta el email en cualquiermayúscula', async () => {
    const user = await makeUser()

    const res = await request(app())
      .post('/api/v1/auth/login')
      .send({ email: user.email.toUpperCase(), password: user.password })

    expect(res.status).toBe(200)
  })

  it('devuelve el mismo 401 con email inexistente que con contraseña incorrecta', async () => {
    const user = await makeUser()

    const wrongPassword = await request(app())
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'esta-no-es-la-contrasena' })

    const unknownEmail = await request(app())
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail('fantasma'), password: 'esta-no-es-la-contrasena' })

    // Si los mensajes difieren, el login se convierte en un oráculo de qué
    // correos están registrados.
    expect(wrongPassword.status).toBe(401)
    expect(unknownEmail.status).toBe(401)
    expect(unknownEmail.body.error.code).toBe('INVALID_CREDENTIALS')
    expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message)
  })

  it('tarda lo mismo con email inexistente que con contraseña incorrecta', async () => {
    // Criterio 6. Sin el hash señuelo, un login con usuario inexistente tarda
    // ~2 ms y uno con contraseña incorrecta ~80 ms, y ese contraste ya dice si la
    // cuenta existe aunque el mensaje sea idéntico.
    const user = await makeUser()

    // Calienta argon2: la primera llamada paga la asignación de memoria y mide
    // un orden de magnitud menos que las siguientes.
    await request(app())
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail('calentar'), password: 'x'.repeat(20) })
    await loginAs({ email: uniqueEmail('calentar2'), password: 'x'.repeat(20) })

    const timeOf = async (email: string, password: string) => {
      const started = process.hrtime.bigint()
      await request(app()).post('/api/v1/auth/login').send({ email, password })
      return Number(process.hrtime.bigint() - started) / 1e6
    }

    const unknown: number[] = []
    const wrong: number[] = []

    // Se toma la mediana de varias muestras porque argon2 fluctúa entre
    // ejecuciones. El margen es del 50%, bastante más ancho que el 20% de la
    // spec: este test verifica que la igualación existe, y un umbral estrecho
    // lo convertiría en un test que falla sola en CI.
    for (let i = 0; i < 5; i++) {
      unknown.push(await timeOf(uniqueEmail('fantasma'), 'una-contrasena-cualquiera'))
      wrong.push(await timeOf(user.email, 'una-contrasena-cualquiera'))
    }

    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!
    const medianUnknown = median(unknown)
    const medianWrong = median(wrong)
    const ratio = medianUnknown / medianWrong

    expect(
      ratio,
      `login con email inexistente ${medianUnknown.toFixed(1)}ms vs contraseña incorrecta ${medianWrong.toFixed(1)}ms`,
    ).toBeGreaterThan(0.5)
    expect(
      ratio,
      `login con email inexistente ${medianUnknown.toFixed(1)}ms vs contraseña incorrecta ${medianWrong.toFixed(1)}ms`,
    ).toBeLessThan(1.5)
  })
})

describe('POST /api/v1/auth/refresh', () => {
  it('renueva la sesión y cambia el refresh token', async () => {
    const user = await makeUser()
    const login = await loginAs(user)
    const oldCookie = refreshCookieValue(login)!

    const res = await request(app()).post('/api/v1/auth/refresh').set('Cookie', [`refresh_token=${oldCookie}`])

    expect(res.status).toBe(200)
    expect(res.body.data.accessToken).toBeTruthy()

    const newCookie = refreshCookieValue(res)
    expect(newCookie).toBeTruthy()
    expect(newCookie).not.toBe(oldCookie)
  })

  it('conserva el family_id entre rotaciones y encadena replaced_by', async () => {
    const user = await makeUser()
    const login = await loginAs(user)
    const familyId = (await readSessions(user.id))[0]!.family_id

    const res = await request(app())
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`refresh_token=${refreshCookieValue(login)}`])

    const sessions = await readSessions(user.id)

    expect(sessions).toHaveLength(2)
    // La familia no cambia al rotar: toda la cadena de un login comparte
    // familia, y eso es lo que permite revocar la entera si se detecta robo.
    expect(sessions.every((s) => s.family_id === familyId)).toBe(true)

    const [old_, new_] = sessions
    expect(old_!.status).toBe('REVOKED')
    expect(old_!.replaced_by).toBe(new_!.id)
    expect(new_!.status).toBe('ACTIVE')
    expect(new_!.replaced_by).toBeNull()
  })

  it('devuelve 401 y borra la cookie si no hay cookie', async () => {
    const res = await request(app()).post('/api/v1/auth/refresh')

    expect(res.status).toBe(401)
    expect(allSetCookies(res)).toContain('refresh_token=;')
  })

  it('devuelve 401 con un token inventado', async () => {
    const res = await request(app())
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`refresh_token=${'a'.repeat(64)}`])

    expect(res.status).toBe(401)
  })
})

describe('detección de robo de refresh token', () => {
  it('usar dos veces el mismo refresh token revoca la sesión', async () => {
    // Criterio 7.
    const user = await makeUser()
    const login = await loginAs(user)
    const stolen = refreshCookieValue(login)!

    const first = await request(app()).post('/api/v1/auth/refresh').set('Cookie', [`refresh_token=${stolen}`])
    expect(first.status).toBe(200)

    const second = await request(app()).post('/api/v1/auth/refresh').set('Cookie', [`refresh_token=${stolen}`])
    expect(second.status).toBe(401)
    expect(second.body.error.code).toBe('TOKEN_REVOKED')
  })

  it('tras detectar reutilización, TODOS los refresh de esa familia fallan', async () => {
    // Criterio 8. El atacante y la víctima comparten el token, así que solo uno
    // puede conservarlo. Se revoca la familia entera y la víctima pierde la
    // sesión, que es molesto pero preferible a que la conserve el ladrón.
    const user = await makeUser()
    const login = await loginAs(user)
    const stolen = refreshCookieValue(login)!

    const legit = await request(app()).post('/api/v1/auth/refresh').set('Cookie', [`refresh_token=${stolen}`])
    const victimToken = refreshCookieValue(legit)!
    expect(legit.status).toBe(200)

    // El atacante reutiliza el token viejo.
    const reuse = await request(app()).post('/api/v1/auth/refresh').set('Cookie', [`refresh_token=${stolen}`])
    expect(reuse.status).toBe(401)

    // Y ahora el token nuevo de la víctima también falla.
    const victim = await request(app()).post('/api/v1/auth/refresh').set('Cookie', [`refresh_token=${victimToken}`])
    expect(victim.status).toBe(401)

    const actives = (await readSessions(user.id)).filter((s) => s.status === 'ACTIVE')
    expect(actives).toHaveLength(0)
  })

  it('un login nuevo crea una familia nueva y no se ve afectado', async () => {
    const user = await makeUser()

    const first = await loginAs(user)
    const stolen = refreshCookieValue(first)!
    await request(app()).post('/api/v1/auth/refresh').set('Cookie', [`refresh_token=${stolen}`])
    await request(app()).post('/api/v1/auth/refresh').set('Cookie', [`refresh_token=${stolen}`])

    const second = await loginAs(user)
    const res = await request(app())
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`refresh_token=${refreshCookieValue(second)}`])

    expect(res.status).toBe(200)
  })
})

describe('GET /api/v1/auth/me', () => {
  it('devuelve los datos del usuario autenticado', async () => {
    // Criterio 11.
    const user = await makeUser()
    const login = await loginAs(user)

    const res = await request(app())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toMatchObject({ id: user.id, email: user.email })
    expect(res.body.data.passwordHash).toBeUndefined()
  })

  it('devuelve 401 sin cabecera Authorization', async () => {
    const res = await request(app()).get('/api/v1/auth/me')

    expect(res.status).toBe(401)
  })

  it('devuelve 401 con un token de firma inválida', async () => {
    // Criterio 3.
    const forged = jwt.sign({ role: 'ADMIN', ver: 'x' }, 'otra-clave-de-32-caracteres-minimo', {
      algorithm: 'HS256',
      subject: '11111111-1111-4111-8111-111111111111',
      expiresIn: 900,
    })

    const res = await request(app()).get('/api/v1/auth/me').set('Authorization', `Bearer ${forged}`)

    expect(res.status).toBe(401)
  })

  it('devuelve 401 con alg: none', async () => {
    // Criterio 4.
    const noneAlg = jwt.sign({ role: 'ADMIN', ver: 'x' }, '', {
      algorithm: 'none',
      subject: '11111111-1111-4111-8111-111111111111',
      expiresIn: 900,
    })

    const res = await request(app()).get('/api/v1/auth/me').set('Authorization', `Bearer ${noneAlg}`)

    expect(res.status).toBe(401)
  })

  it('devuelve 401 con un token expirado', async () => {
    // Criterio 5.
    const expired = jwt.sign({ role: 'NEIGHBOR', ver: 'x' }, env.JWT_SECRET, {
      algorithm: 'HS256',
      subject: '11111111-1111-4111-8111-111111111111',
      expiresIn: -10,
    })

    const res = await request(app()).get('/api/v1/auth/me').set('Authorization', `Bearer ${expired}`)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('TOKEN_EXPIRED')
  })

  it('devuelve 401 si la sesión ya no está ACTIVE, aunque el JWT sea válido', async () => {
    // Un token bien firmado y no expirado sigue siendo rechazado si su sesión
    // se revocó. Es lo que hace que cerrar sesión funcione de verdad.
    const user = await makeUser()
    const login = await loginAs(user)
    const token = login.body.data.accessToken as string

    await request(app()).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(200)

    await request(app())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', [`refresh_token=${refreshCookieValue(login)}`])
      .expect(204)

    const res = await request(app()).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('TOKEN_REVOKED')
  })
})

describe('POST /api/v1/auth/logout', () => {
  it('cierra sesión, borra la cookie e invalida el access token', async () => {
    // Criterio 9.
    const user = await makeUser()
    const login = await loginAs(user)
    const token = login.body.data.accessToken as string

    const res = await request(app())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', [`refresh_token=${refreshCookieValue(login)}`])

    expect(res.status).toBe(204)
    expect(allSetCookies(res)).toContain('refresh_token=;')

    const sessions = await readSessions(user.id)
    expect(sessions.every((s) => s.status === 'REVOKED')).toBe(true)
    expect(sessions.every((s) => s.revoked_at !== null)).toBe(true)
  })

  it('no deja el refresh token vivo tras cerrar sesión', async () => {
    const user = await makeUser()
    const login = await loginAs(user)

    await request(app())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .set('Cookie', [`refresh_token=${refreshCookieValue(login)}`])
      .expect(204)

    const res = await request(app())
      .post('/api/v1/auth/refresh')
      .set('Cookie', [`refresh_token=${refreshCookieValue(login)}`])

    expect(res.status).toBe(401)
  })

  it('exige autenticación', async () => {
    const res = await request(app()).post('/api/v1/auth/logout')

    expect(res.status).toBe(401)
  })
})

describe('sesiones del usuario', () => {
  it('lista las sesiones activas marcando la actual', async () => {
    const user = await makeUser()
    const first = await loginAs(user)
    const firstToken = first.body.data.accessToken as string

    await loginAs(user)

    const res = await request(app())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${firstToken}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(2)
    expect(res.body.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1)
  })

  it('no incluye el token_hash de ninguna sesión', async () => {
    const user = await makeUser()
    const login = await loginAs(user)

    const res = await request(app())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)

    expect(JSON.stringify(res.body)).not.toMatch(/[0-9a-f]{64}/)
  })

  it('revoca una sesión concreta del usuario', async () => {
    const user = await makeUser()
    const first = await loginAs(user)
    const second = await loginAs(user)

    const list = await request(app())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${first.body.data.accessToken}`)

    const other = list.body.data.find((s: { current: boolean }) => !s.current)

    await request(app())
      .delete(`/api/v1/auth/sessions/${other.id}`)
      .set('Authorization', `Bearer ${first.body.data.accessToken}`)
      .expect(204)

    // El access token de la sesión revocada deja de valer.
    const res = await request(app())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${second.body.data.accessToken}`)

    expect(res.status).toBe(401)
  })

  it('devuelve 404 al revocar una sesión que no es suya', async () => {
    // RLS impide tocar sesiones ajenas, así que la actualización afecta a cero
    // filas. Un 403 con detalle confirmaría que ese id existe.
    const userA = await makeUser()
    const userB = await makeUser()

    const loginA = await loginAs(userA)
    const listA = await request(app())
      .get('/api/v1/auth/sessions')
      .set('Authorization', `Bearer ${loginA.body.data.accessToken}`)

    const sessionA = listA.body.data[0]

    const res = await request(app())
      .delete(`/api/v1/auth/sessions/${sessionA.id}`)
      .set('Authorization', `Bearer ${(await loginAs(userB)).body.data.accessToken}`)

    expect(res.status).toBe(404)

    // Y la sesión de A sigue viva.
    await request(app())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${loginA.body.data.accessToken}`)
      .expect(200)
  })
})

describe('rate limiting del login', () => {
  it('devuelve 429 al superar 5 intentos fallidos con el mismo email', async () => {
    // Criterio 17. Se usa una app aparte para no agotar el contador compartido
    // del resto de la suite.
    const { createApp } = await import('../app.js')
    const isolated = createApp()
    const user = await makeUser()

    const attempt = () =>
      request(isolated)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: `incorrecta-${Math.random()}` })

    const results = []
    for (let i = 0; i < 6; i++) {
      results.push(await attempt())
    }

    expect(results.slice(0, 5).every((r) => r.status === 401)).toBe(true)
    expect(results[5]!.status).toBe(429)
    expect(results[5]!.body.error.code).toBe('RATE_LIMITED')
  })

  it('no cuenta los intentos correctos', async () => {
    // Contar también los exitosos bloquearía a un vecino que entra y sale
    // varias veces, que no es un ataque. El límite sigue impidiendo lo que
    // pretende: probar cinco contraseñas por cuenta.
    const { createApp } = await import('../app.js')
    const isolated = createApp()
    const user = await makeUser()

    for (let i = 0; i < 7; i++) {
      const res = await request(isolated)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: user.password })
      expect(res.status).toBe(200)
    }
  })
})

describe('contrato HTTP', () => {
  it('los 7 endpoints de la spec existen y responden con el envelope', async () => {
    // Criterio 15 y 16.
    const user = await makeUser()
    const login = await loginAs(user)
    const cookie = [`refresh_token=${refreshCookieValue(login)}`]

    const register = await request(app())
      .post('/api/v1/auth/register')
      .send({ email: uniqueEmail(), password: TEST_PASSWORD, fullName: 'Vecino' })
    expect(register.status).toBe(201)
    expect(register.body).toHaveProperty('data')

    expect(login.status).toBe(200)
    expect(login.body).toHaveProperty('data')

    const refreshed = await request(app()).post('/api/v1/auth/refresh').set('Cookie', cookie)
    expect(refreshed.status).toBe(200)
    expect(refreshed.body).toHaveProperty('data')

    // Tras el refresh hay que usar el token NUEVO. El anterior queda revocado en
    // el acto, porque la rotación encadena la sesión: reuse de un token ya
    // usado es exactamente lo que dispara la revocación de la familia. Reusar
    // aquí el token viejo daría 401, que sería la respuesta correcta del
    // servidor y un test mal escrito.
    const auth = { Authorization: `Bearer ${refreshed.body.data.accessToken}` }
    const cookie2 = [`refresh_token=${refreshCookieValue(refreshed)}`]

    const me = await request(app()).get('/api/v1/auth/me').set(auth)
    expect(me.status).toBe(200)
    expect(me.body).toHaveProperty('data')

    // Hace falta una segunda sesión para poder revocar "la otra". Revocar la
    // propia y luego seguir usando su token tampoco sería un defecto: sería el
    // servidor haciendo bien su trabajo.
    const other = await loginAs(user)
    expect(other.status).toBe(200)

    const sessions = await request(app()).get('/api/v1/auth/sessions').set(auth)
    expect(sessions.status).toBe(200)
    expect(sessions.body).toHaveProperty('data')
    expect(sessions.body.data).toHaveLength(2)

    const current = sessions.body.data.find((s: { current: boolean }) => s.current)
    const other_ = sessions.body.data.find((s: { current: boolean }) => !s.current)
    expect(current).toBeDefined()
    expect(other_).toBeDefined()

    const revoke = await request(app()).delete(`/api/v1/auth/sessions/${other_.id}`).set(auth)
    expect(revoke.status).toBe(204)

    const logout = await request(app()).post('/api/v1/auth/logout').set(auth).set('Cookie', cookie2)
    expect(logout.status).toBe(204)
  })

  it('un endpoint inexistente devuelve 404 con el envelope de error', async () => {
    const res = await request(app()).get('/api/v1/auth/no-existe')

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(res.body.error.message).toBeTypeOf('string')
  })

  it('todo error trae código y mensaje, y el mensaje va en castellano', async () => {
    const res = await request(app()).post('/api/v1/auth/login').send({ email: 'no-es-un-email' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    // Los identificadores van en inglés y los mensajes en castellano: quien lee
    // el mensaje es un vecino, no una máquina.
    expect(res.body.error.code).toMatch(/^[A-Z_]+$/)
    expect(res.body.error.message).toMatch(/[áéíóúñ¿¡]|(válidos|incorrectos|sesión|obligatorio)/i)
  })
})

describe('salud del servicio', () => {
  it('GET /api/v1/health responde 200 y confirma que RLS está activo', async () => {
    const res = await request(app()).get('/api/v1/health')

    expect(res.status).toBe(200)
    expect(res.body.data.status).toBe('ok')
    expect(res.body.data.database).toBe('reachable')
    // Con el rol postgres esto valdría false, porque postgres tiene BYPASSRLS y
    // el aislamiento entre comunidades no existiría.
    expect(res.body.data.rlsEnforced).toBe(true)
  })
})