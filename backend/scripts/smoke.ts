// ---------------------------------------------------------------------------
// Prueba de humo de punta a punta, contra el servidor REAL y la BD real.
//
// Qué cubre y qué no:
//   - Los tests de integración ya exercised el servidor de Express dentro del
//     proceso de Vitest, pero con la app en memoria. Esta prueba levanta el
//     flujo por HTTP de verdad, con cabeceras, cookies y el protocolo entero.
//   - Es la única comprobación que recorre el camino completo: HTTP -> middleware
//     -> RLS -> Postgres. Un fallo de RLS o de cookie solo aparece aquí.
//   - NO sustituye a `npm run test:integration`. Es más lenta y depende de que
//     el servidor esté levantado, así que no va en el ciclo de tests.
//
// Uso:
//   npm run dev            (en otra terminal)
//   npm run db:seed        (si la BD está vacía)
//   npm run smoke
//
// Requiere MIGRATION_DATABASE_URL solo para contar sesiones; si se quita, el
// script funciona igual y esa comprobación se salta.
// ---------------------------------------------------------------------------

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000/api/v1/auth'
const CRED = { email: 'ana@comunidad-a.test', password: 'CommunityHub2026' }

// Credenciales de demo que imprime `npm run db:seed`. Solo sirven contra la BD
// de desarrollo; nunca contra un entorno con datos de verdad.
const MIGRATION_URL = process.env.MIGRATION_DATABASE_URL
const admin = MIGRATION_URL
  ? new PrismaClient({
      datasources: {
        db: { url: (() => { const u = new URL(MIGRATION_URL!); u.searchParams.delete('sslmode'); return u.toString() })() },
      },
    })
  : null

async function call(method: string, path: string, opts: { token?: string; cookie?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {}
  if (opts.token) headers.authorization = `Bearer ${opts.token}`
  if (opts.cookie) headers.cookie = opts.cookie
  if (opts.body) headers['content-type'] = 'application/json'
  const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
  const text = await res.text()
  let body: any = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { status: res.status, body, headers: res.headers }
}

async function login(email = CRED.email, password = CRED.password) {
  const res = await call('POST', '/login', { body: { email, password } })
  const cookie = 'refresh_token=' + (/refresh_token=([^;]*)/.exec(res.headers?.getSetCookie?.().join('') ?? '')?.[1] ?? '')
  return { ...res, cookie }
}

const n = async (email: string) =>
  admin
    ? (
        await admin.$queryRaw<Array<{ n: number }>>`
          select count(*)::int as n from sessions s join users u on u.id = s.user_id where u.email = ${email}
        `
      )[0]?.n
    : null

let fallos = 0
const check = (label: string, got: number, want: number, extra = '') => {
  const ok = got === want
  if (!ok) fallos++
  console.log(`   ${ok ? 'OK  ' : 'FALLO'} ${label.padEnd(30)} ${got}${extra}  (esperado ${want})`)
}

console.log('\nA. Camino feliz')
{
  const l = await login()
  check('login', l.status, 200, `  rol=${l.body.data?.user?.globalRole}`)
  check('cookie httpOnly', /HttpOnly/i.test(String(l.headers?.getSetCookie?.() ?? '')) ? 1 : 0, 1)
  check('cookie SameSite=Strict', /SameSite=Strict/i.test(String(l.headers?.getSetCookie?.() ?? '')) ? 1 : 0, 1)

  const me = await call('GET', '/me', { token: l.body.data.accessToken })
  check('me', me.status, 200, `  ${me.body.data?.email}`)

  const r = await call('POST', '/refresh', { cookie: l.cookie })
  check('refresh', r.status, 200)
  const token2 = r.body.data?.accessToken
  const cookie2 = 'refresh_token=' + (/refresh_token=([^;]*)/.exec(r.headers?.getSetCookie?.().join('') ?? '')?.[1] ?? '')

  const me2 = await call('GET', '/me', { token: token2 })
  check('me con token rotado', me2.status, 200, `  ${me2.body.data?.email}`)

  const s = await call('GET', '/sessions', { token: token2 })
  check('sessions', s.status, 200, `  ${s.body.data?.length} activas`)

  const out = await call('POST', '/logout', { token: token2, cookie: cookie2 })
  check('logout', out.status, 204)

  check('me tras logout', (await call('GET', '/me', { token: token2 })).status, 401)
  check('refresh tras logout', (await call('POST', '/refresh', { cookie: cookie2 })).status, 401)
}

console.log('\nB. Ataque: reutilizar un refresh token ya usado')
{
  const l = await login()
  const r = await call('POST', '/refresh', { cookie: l.cookie })
  check('refresh', r.status, 200)
  const token2 = r.body.data?.accessToken

  const reuse = await call('POST', '/refresh', { cookie: l.cookie })
  check('reutilizar el viejo', reuse.status, 401, `  ${reuse.body.error?.code}`)

  check('el token nuevo tambien cae', (await call('GET', '/me', { token: token2 })).status, 401)
}

console.log('\nC. Ataque: token inventado')
{
  const fake = await call('POST', '/refresh', { cookie: 'refresh_token=' + 'a'.repeat(64) })
  check('token inexistente', fake.status, 401, `  ${fake.body.error?.code}`)

  const bad = await call('GET', '/me', { token: 'no.es.un.jwt' })
  check('access token invalido', bad.status, 401, `  ${bad.body.error?.code}`)
}

console.log('\nD. Login: credenciales malas')
{
  const bad = await call('POST', '/login', { body: { email: CRED.email, password: ' incorrecta' } })
  check('password incorrecta', bad.status, 401, `  ${bad.body.error?.code}`)

  const noexiste = await call('POST', '/login', { body: { email: 'nadie@ejemplo.test', password: 'CommunityHub2026' } })
  check('email inexistente', noexiste.status, 401, `  ${noexiste.body.error?.code}`)
}

// Informativo: nº de sesiones del usuario de demo. Cada ejecución de esta
// prueba deja una sesión revocada, así que el número sube; no es un criterio.
const quedan = await n(CRED.email)
if (quedan !== null) console.log(`\nsesiones activas de ${CRED.email} ahora: ${quedan}`)

console.log(`\n${fallos === 0 ? 'Todo correcto.' : `${fallos} comprobacion(es) fallida(s).`}`)

await admin?.$disconnect()
process.exit(fallos === 0 ? 0 : 1)
