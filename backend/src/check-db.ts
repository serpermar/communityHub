// ---------------------------------------------------------------------------
// check:db · comprueba que el .env es correcto y que RLS filtra de verdad.
//
// No escribe nada. Se puede ejecutar en cuanto se tenga el .env.
//
//   npm run check:db
//
// Hace cuatro cosas, y las cuatro son necesarias:
//
//   1. La URL tiene el usuario app_runtime, no postgres.
//   2. La conexion abre.
//   3. current_user es app_runtime en la conexion del pool.
//   4. Sin contexto, count(incidents) = 0. Porque sin SET LOCAL, las politicas
//      no tienen sobre quien evaluarse y RLS deniega. Si aqui saliera un
//      numero mayor que cero, el aislamiento NO esta funcionando.
// ---------------------------------------------------------------------------

import 'dotenv/config'
import { prisma } from './db.js'
import { withContext } from './context.js'

const ZERO = '00000000-0000-0000-0000-000000000000'

let failed = false

function ok(msg: string) {
  console.log(`  OK    ${msg}`)
}

function bad(msg: string, hint?: string) {
  console.error(`  FALLO ${msg}`)
  if (hint) console.error(`        ${hint}`)
  failed = true
}

async function main() {
  console.log('\n1. Configuracion\n')

  const url = process.env.DATABASE_URL ?? ''
  const u = (() => {
    try {
      return new URL(url.replace(/^postgresql:\/\//, 'https://'))
    } catch {
      return null
    }
  })()

  if (!u) {
    bad('DATABASE_URL no existe o no es una URL valida')
  } else {
    const user = decodeURIComponent(u.username)

    if (user.startsWith('postgres')) {
      bad(
        `DATABASE_URL conecta como "${user}", no como app_runtime`,
        'El rol postgres tiene BYPASSRLS: la app funcionaria y devolveria datos ' +
          'de otras comunidades. Pon app_runtime.TU_PROJECT_REF en esa variable.',
      )
    } else if (!user.startsWith('app_runtime')) {
      bad(`el usuario es "${user}" y se esperaba app_runtime`)
    } else {
      ok(`usuario ${user}`)
    }

    if (u.port === '6543') {
      bad(
        'puerto 6543 (Transaction pooler)',
        'Transaction mode pierde el estado entre transacciones, y con el el ' +
          'contexto de RLS. Usa el 5432 (Session pooler).',
      )
    } else if (u.port !== '5432') {
      bad(`puerto ${u.port}, se esperaba 5432`)
    } else {
      ok('puerto 5432 (Session pooler)')
    }

    if (!url.includes('sslmode=require')) {
      bad('falta sslmode=require', 'La conexion ira sin cifrar.')
    } else {
      ok('sslmode=require')
    }
  }

  if (!process.env.MIGRATION_DATABASE_URL) {
    bad('MIGRATION_DATABASE_URL no esta definida')
  } else {
    ok('MIGRATION_DATABASE_URL definida')
  }

  console.log('\n2. Conexion\n')

  try {
    const rows = await prisma.$queryRaw<Array<{ version: string }>>`select version()`
    const version = rows[0]?.version ?? ''
    if (!version) {
      bad('la consulta version() no devolvio nada')
    } else {
      ok(version.split(' on ')[0]?.split(',')[0] ?? version)
    }
  } catch (e) {
    bad('no se pudo abrir la conexion', (e as Error).message.split('\n')[0])
    console.log(
      '\nSin conexion no se puede seguir. Revisa la contrasena (percent-codificada ' +
        'en la URL) y que app_runtime tenga login.\n',
    )
    process.exit(1)
  }

  console.log('\n3. Identidad del rol\n')

  try {
    const [r] = await prisma.$queryRaw<Array<{ current_user: string; bypass: string }>>`
      select
        session_user::text                             as current_user,
        rolbypassrls::text                             as bypass
      from pg_roles
      where rolname = session_user
    `

    if (r?.current_user === 'app_runtime') {
      ok(`current_user = ${r.current_user}`)
    } else {
      bad(`current_user = ${r?.current_user}`, 'Se esperaba app_runtime.')
    }

    // OJO: rolbypassrls::text devuelve 'false', no 'f'. Ese cast lo cambia.
    if (r?.bypass === 'false') {
      ok('sin BYPASSRLS: las politicas se aplicaran')
    } else {
      bad(
        `el rol tiene BYPASSRLS = ${r?.bypass}`,
        'RLS no se evaluara. Usa un rol sin bypass.',
      )
    }
  } catch (e) {
    bad('no se pudo leer la identidad del rol', (e as Error).message.split('\n')[0])
  }

  console.log('\n4. RLS deniega sin contexto\n')

  try {
    const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
      select count(*)::bigint as n from incidents
    `
    const n = rows[0]?.n ?? -1n

    if (n === 0n) {
      ok('incidents devuelve 0 filas sin contexto (RLS deniega)')
    } else {
      bad(
        `incidents devolvio ${n} filas sin contexto`,
        'RLS NO esta filtrando. Sin SET LOCAL las politicas no tienen sobre quien ' +
          'evaluarse, asi que deberia ver 0. Revisa ENABLE y FORCE en 02_rls.sql.',
      )
    }

    const rows2 = await prisma.$queryRaw<Array<{ n: bigint }>>`
      select count(*)::bigint as n from users
    `
    const n2 = rows2[0]?.n ?? -1n

    if (n2 === 0n) {
      ok('users devuelve 0 filas sin contexto')
    } else {
      bad(`users devolvio ${n2} filas sin contexto`, 'Revisa la politica users_select_self.')
    }
  } catch (e) {
    bad('fallo la consulta de comprobacion', (e as Error).message.split('\n')[0])
  }

  console.log('\n5. Contexto dentro de transaccion\n')

  try {
    const [r] = await withContext({ userId: ZERO, communityId: ZERO }, (tx) =>
      tx.$queryRaw<Array<{ user_id: string; community_id: string; role: string | null }>>`
        select
          app_current_user_id()      as user_id,
          app_current_community_id() as community_id,
          app_role_in(app_current_community_id()) as role
      `,
    )

    if (r?.user_id === ZERO && r?.community_id === ZERO) {
      ok('set_config leido correctamente por las funciones de RLS')
    } else {
      bad(`el contexto no llego a las funciones: ${JSON.stringify(r)}`)
    }

    if (r?.role === null) {
      ok('app_role_in devuelve null sin membresia (correcto con UUID nulo)')
    } else {
      bad(`app_role_in devolvio "${r?.role}" para un UUID inexistente`)
    }
  } catch (e) {
    bad('fallo la prueba de contexto', (e as Error).message.split('\n')[0])
  }

  console.log('')

  if (failed) {
    console.error('Verificacion fallida. Revisa los puntos marcados arriba.\n')
    process.exit(1)
  }

  console.log('Todo correcto. La base de datos esta lista para el backend.\n')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())