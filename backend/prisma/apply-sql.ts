// ---------------------------------------------------------------------------
// Aplicador de los scripts SQL de supabase/sql.
//
// Por qué existe y por qué no es un migrador de Prisma:
//
//   Los scripts de supabase/sql/ son la fuente de verdad del modelo de datos
//   (ver fix-schema.ts). Prisma genera el cliente A PARTIR de ellos, no al revés.
//   Por eso el orden es aplicar SQL -> prisma db pull -> prisma generate, y no
//   migrar con Prisma.
//
//   Hace falta un cliente Postgres de verdad, y no el de Prisma, porque estos
//   archivos contienen cientos de sentencias y `$executeRaw` usa protocolo
//   preparado, que en Postgres solo admite una. `pg` con `client.query()` usa el
//   protocolo simple, que sí admite varias.
//
// Uso:
//   npm run db:apply                            aplica contra MIGRATION_DATABASE_URL
//   npm run db:verify                           aplica y además ejecuta 04_verify.sql
//   npm run db:apply -- --url "postgres://..."  aplica contra otra URL
//
// `db:verify` es un script aparte y no un flag documentado a propósito:
// `npm run db:apply -- --verify` NO hace lo que parece bajo PowerShell, que se
// come el `--verify` y ejecuta la verificación sin ejecutar nada: ni aviso, ni
// fallo, ni 04_verify.sql. Es el peor modo de fallo posible en un verificador,
// y bastaría con que un día el único "en verde" fuera el de un comando que no
// llegó a comprobar nada. Un script sin flags se comporta igual en cualquier
// shell. Para aplicarlo a mano contra otra base:
//   npx tsx prisma/apply-sql.ts --verify
// ---------------------------------------------------------------------------

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from 'pg'

const SQL_DIR = resolve(process.cwd(), '..', 'supabase', 'sql')

// El orden importa. 02_rls.sql crea `app_runtime` y depende de las tablas de
// 01; 02b_auth.sql, 02c_communities.sql, 02d_members.sql, 02e_incidents.sql,
// 02f_common_areas.sql, 02g_reservations.sql, 02h_announcements.sql y
// 03_storage.sql dependen del rol de 02; 04_verify.sql comprueba que todo lo
// anterior existe.
//
// 02e va después de 02d porque su predicado de visibilidad se apoya en
// app_role_in() y app_is_assigned_provider(), que nacen en 02_rls.sql, y en
// nada de 02d. Si algún día 02d dejara de definir app_role_in(), 02e se
// aplicaría con un predicado que devuelve siempre false.
//
// 02f, 02g y 02h van ANTES de 03_storage.sql y en ese orden entre sí: 02f usa
// app_is_member_of/app_role_in de 02_rls, 02g usa app_common_area_community
// de 02f (la creación de reservas resuelve la zona por ahí) y 02h usa
// app_is_member_of/app_role_in de 02_rls para el tablón de avisos. Los tres
// son idempotentes: se pueden re-aplicar sobre una base ya desplegada, que es
// lo que hace falta para desplegar este bloque en producción sin rehechos.
const FILES = [
  '01_schema.sql',
  '02_rls.sql',
  '02b_auth.sql',
  '02c_communities.sql',
  '02d_members.sql',
  '02e_incidents.sql',
  '02f_common_areas.sql',
  '02g_reservations.sql',
  '02h_announcements.sql',
  '03_storage.sql',
]
const VERIFY = '04_verify.sql'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const url =
  arg('url') ??
  process.env.MIGRATION_DATABASE_URL ??
  process.env.DATABASE_URL

if (!url) {
  // Se lanza en vez de llamar a process.exit(1), por lo mismo que al final del
  // script: exit() trunca stdout en Windows y el mensaje es justo lo único que
  // hace falta ver.
  throw new Error('Falta MIGRATION_DATABASE_URL en el .env (o usa --url).')
}

// `onnotice` no aparece en los tipos de `pg`, aunque el cliente lo soporta desde
// siempre. Estos scripts emiten RAISE NOTICE, que es la unica forma de saber que
// ha pasado algo: sin esto los avisos se tragan y el script parece no hacer nada.
type PgClientOptions = ConstructorParameters<typeof Client>[0] & {
  onnotice?: (msg: { message: string }) => void
}

// ---------------------------------------------------------------------------
// TLS
//
// `sslmode=require` no significa lo mismo en libpq que en node-postgres. En
// libpq significa "cifra, pero no compruebes la cadena". En `pg` el valor se
// traduce a `rejectUnauthorized: true`, y la conexion falla con:
//
//   self-signed certificate in certificate chain
//
// porque el pooler de Supabase presenta un certificado firmado por la CA de
// Supabase, que no esta en ningun almacen de CA publico. Verificar contra las CA
// del sistema es imposible, no un descuido de configuracion.
//
// De ahi las dos opciones, y el orden importa:
//
//   1. POSTGRES_CA_CERT_PATH (o PGSSLROOTCERT, el nombre de libpq) apunta al
//      certificado de Supabase. Se verifica de verdad. Es lo correcto.
//   2. Sin certificado: se quita `sslmode` de la URL y se cifra sin verificar,
//      que es exactamente lo que ya hace Prisma con `sslmode=require` en el
//      cliente del backend. Se avisa, porque no es lo mismo que verificar.
//
// Nota: el `sslmode` se tiene que BORRAR de la URL. Si se deja, `pg` vuelve a
// sobrescribir el objeto `ssl` que se le pasa y el fallo reaparece.
// ---------------------------------------------------------------------------
function buildTls(rawUrl: string): { connectionString: string; ssl: object | false; note: string } {
  const url = new URL(rawUrl)
  const mode = url.searchParams.get('sslmode')
  url.searchParams.delete('sslmode')

  if (mode === 'disable') {
    return { connectionString: url.toString(), ssl: false, note: 'sslmode=disable: sin TLS' }
  }

  const caPath = process.env.POSTGRES_CA_CERT_PATH ?? process.env.PGSSLROOTCERT
  if (caPath) {
    return {
      connectionString: url.toString(),
      ssl: { ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true },
      note: `verificando el certificado contra ${caPath}`,
    }
  }

  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: false },
    note: 'cifrado SIN verificar el certificado (sin POSTGRES_CA_CERT_PATH)',
  }
}

const tls = buildTls(url)

const options: PgClientOptions = {
  connectionString: tls.connectionString,
  ssl: tls.ssl,
  onnotice: (msg) => console.log(`     · ${msg.message}`),
}

// Se pasa por variable y no en linea porque el literal perderia el chequeo de
// propiedades sobrantes: al construirlo aqui, TypeScript lo valida contra
// PgClientOptions, que es el tipo que si conoce `onnotice`.
const client = new Client(options)

// Todo lo que viene después va en una función y no en el nivel superior, por un
// motivo concreto: `process.exit()` se cierra SÍ O SÍ, y en Windows eso trunca lo
// que hubiera pendiente en stdout cuando stdout es una tubería (una tarea de CI,
// `> log.txt`, `| Tee-Object`). Con el proceso cerrándose a la fuerza, el final
// del informe y los RAISE NOTICE de 04_verify.sql se perdían, y con ellos el
// mensaje de error si la verificación fallaba.
//
// Es decir: el verificador se callaba justo cuando tenía algo que decir, que es
// la peor forma de fallar. Con `process.exitCode` y terminación natural, Node
// vacía stdout antes de salir y no hace falta process.exit() en ningún sitio.
async function main(): Promise<void> {
  console.log(`TLS: ${tls.note}`)

  try {
    await client.connect()
  } catch (error) {
    console.error('No se ha podido conectar:', error instanceof Error ? error.message : error)
    process.exitCode = 1
    return
  }

  const files = process.argv.includes('--verify') ? [...FILES, VERIFY] : FILES
  let failed = false

  for (const file of files) {
    const sql = readFileSync(resolve(SQL_DIR, file), 'utf8')
    process.stdout.write(`${file} `)
    try {
      await client.query(sql)
      console.log('· aplicado')
    } catch (error) {
      failed = true
      console.log('· FALLÓ')
      console.error(error instanceof Error ? error.message : error)
      break
    }
  }

  if (!failed && files.includes(VERIFY)) {
    console.log('\n04_verify.sql terminó sin excepciones: todo en verde.')
  }

  await client.end()
  process.exitCode = failed ? 1 : 0
}

await main()