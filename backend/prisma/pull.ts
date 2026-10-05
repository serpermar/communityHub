// ---------------------------------------------------------------------------
// Regenerar schema.prisma DESPUÉS de aplicar el SQL.
//
// Por qué este script existe y no basta con `prisma db pull`:
//
//   El datasource de schema.prisma apunta a env("DATABASE_URL"), que en este
//   proyecto es el ROL DE LA APLICACIÓN (app_runtime), no el dueño. Con ese rol,
//   `prisma db pull` no ve las columnas de las tablas a las que app_runtime no
//   tiene privilegio — y hay al menos una, `ai_cache`, a la que no tiene ninguno
//   porque solo se usa a través de app_ai_cache_get() y app_ai_cache_put().
//
//   El síntoma es desconcertante: Prisma no dice que le faltan permisos. Escribe
//   el modelo en el archivo igual, pero comentado:
//
//     /// We could not retrieve columns for the underlying table.
//     // model AiCache {
//     // @@map("ai_cache")
//     // }
//
//   Es decir, `prisma db pull` falla en silencio: no sale con código de error, el
//   mensaje parece un aviso, y el resultado es un schema.prisma que compila y
//   genera cliente, pero al que le faltan tablas. Peor aún después de un
//   `db:generate`: el modelo desaparece y el backend deja de compilar, por un
//   motivo que no aparece en el error de TypeScript.
//
//   Aquí se ejecuta el pull con MIGRATION_DATABASE_URL (el dueño) en DATABASE_URL
//   solo para el subproceso, y se comprueba que el archivo resultante no haya
//   perdido ningún modelo antes de darlo por bueno.
//
// AVISO QUE IMPORTA: este archivo es GENERADO y `prisma db pull` reescribe todo lo
// que no puede deducir de la base de datos, incluidos los comentarios a mano. Los
// que hay en schema.prisma están marcados como "COMENTARIO A MANO" y hay que
// volver a ponerlos después del pull. La fuente de verdad de todo el modelo es
// supabase/sql/, así que nada se pierde de verdad, pero el comentario sí.
//
// Uso:
//   npm run db:pull
// ---------------------------------------------------------------------------

import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SCHEMA = resolve(process.cwd(), 'prisma', 'schema.prisma')

const owner = process.env.MIGRATION_DATABASE_URL
if (!owner) {
  throw new Error('Falta MIGRATION_DATABASE_URL en el .env.')
}

// Un `model Foo {` comentado cuenta como modelo perdido.
function modelosActivos(): number {
  const src = readFileSync(SCHEMA, 'utf8')
  return (src.match(/^model \w+ \{/gm) ?? []).length
}

const antes = modelosActivos()
console.log(`modelos antes: ${antes}`)
console.log('ejecutando prisma db pull con el usuario dueño...')

const result = spawnSync('npx', ['prisma', 'db', 'pull'], {
  env: { ...process.env, DATABASE_URL: owner },
  stdio: 'inherit',
  shell: true,
})

if (result.status !== 0) {
  process.exitCode = result.status ?? 1
  throw new Error('prisma db pull ha fallado.')
}

const despues = modelosActivos()
console.log(`modelos después: ${despues}`)

if (despues < antes) {
  // Es el modo de fallo de más arriba, y aquí se detecta antes de que el
  // `db:generate` de después convierta una tabla que falta en un error de
  // TypeScript que no señala la causa.
  throw new Error(
    `El pull ha perdido modelos (${antes} -> ${despues}). ` +
      'Suele ser que la introspección va con un rol sin privilegios: revisa que ' +
      'MIGRATION_DATABASE_URL sea el usuario dueño y no app_runtime.',
  )
}

if (despues === antes) {
  console.log('OK · schema.prisma regenerado, mismo número de modelos.')
} else {
  console.log(`OK · schema.prisma regenerado (${antes} -> ${despues} modelos).`)
}