// ---------------------------------------------------------------------------
// fix-schema.ts · Reaplica el mapeo a camelCase después de `prisma db pull`.
//
// El problema que resuelve:
//
//   `prisma db pull` genera los modelos con el nombre de la TABLA: `users`,
//   `vote_responses`, `community_members`. En TypeScript eso da
//   prisma.vote_responses, que no es idiomático.
//
//   Lo correcto es que en la base de datos los nombres sigan siendo snake_case
//   (convención sana en Postgres) y que el código use PascalCase singular, con
//   @@map diciendo "este modelo vive en esta tabla". Eso obliga a tocar el
//   esquema, y db pull sobrescribe el archivo entero.
//
//   Así que este script es el paso intermedio: db pull genera el mapeo crudo
//   desde la base de datos, y esto lo traduce.
//
// Uso:
//   npm run db:sync        = db:pull + fix + generate
//
// Por qué un script y no editar a mano: el esquema se regenera cada vez que
// cambia el SQL, y eso va a pasar varias veces. Un mapeo escrito a mano se
// pierde en el siguiente db pull sin avisar, y el typecheck falla con veinte
// errores que no dicen nada útil.
//
// IDEMPOTENTE Y AUTORREPARADOR. El mapeo se deduce de los @@map que ya hay en el
// archivo, no solo de los que se añaden en esta ejecución. Así, si una pasada
// quedó a medias (modelos renombrados pero referencias sin actualizar), la
// siguiente la completa. Ese fue un bug real de la primera versión.
//
// Sobre los ENUMS: se dejan tal cual los genera Prisma, con el nombre del tipo
// en la base de datos (member_role, incident_priority). No es consistente con
// los modelos, pero es que Prisma NO admite @@map en enums y renombrarlos rompe
// la introspección: `MemberRole` buscaría un tipo que en Postgres se llama
// `member_role` y no lo encontraría. Es una limitación de la herramienta.
//
// La fuente de verdad sigue siendo 01_schema.sql. Este script no decide nada
// sobre la base de datos: solo cómo se llama cada cosa desde TypeScript.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const schemaPath = join(here, 'schema.prisma')

/**
 * Tabla de excepciones para nombres que no siguen la regla regular.
 * Vacía hoy: ninguno de los 24 nombres es irregular. Se mantiene explícita en
 * lugar de escribir una heurística (quitar la 's' final a ciegas) que un día
 * rompería con un nombre como 'news'.
 */
const IRREGULAR: Record<string, string> = {}

function pascalModel(snake: string): string {
  const parts = snake.split('_').filter(Boolean)
  const base = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')
  return IRREGULAR[snake] ?? base
}

// ---------------------------------------------------------------------------

let text = readFileSync(schemaPath, 'utf8')

// ---------------------------------------------------------------------------
// 1. Mapa tabla -> modelo, deduciendo de lo que ya hay.
//
// Tres casos posibles en el archivo, y hay que reconocerlos todos:
//
//   a) Recién salido de db pull:      model users { ... }        sin @@map
//   b) Ya mapeado por este script:    model User  { ... @@map("users") }
//   c) Mapeado a medias:              model User  { ... @@map("users") } pero
//                                     alguna referencia de tipo sin arreglar
//
// (a) y (b) necesitan el mismo tratamiento: lo único que cambia es de dónde se
// saca el nombre de la tabla.
// ---------------------------------------------------------------------------

const mapeo = new Map<string, string>() // tabla -> modelo PascalCase

// (b) y (c): deducir del @@map que ya existe.
for (const m of text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
  const modelo = m[1]!
  const map = m[2]!.match(/@@map\("([^"]+)"\)/)
  if (map) mapeo.set(map[1]!, modelo)
}

// (a): los que aún no tienen @@map son los que hay que renombrar.
const porRenombrar: Array<{ tabla: string; modeloNuevo: string }> = []

for (const m of text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
  const actual = m[1]!
  if (mapeo.has(actual)) continue // ya tiene @@map

  porRenombrar.push({ tabla: actual, modeloNuevo: pascalModel(actual) })
  mapeo.set(actual, pascalModel(actual))
}

if (mapeo.size === 0) {
  console.log('  fix-schema · el esquema no tiene modelos. ¿Ejecutaste db:pull?')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 2. Renombrar cabeceras de los que faltan por mapear.
// ---------------------------------------------------------------------------

for (const { tabla, modeloNuevo } of porRenombrar) {
  text = text.replace(
    new RegExp(`^model\\s+${tabla}\\s*\\{`, 'm'),
    `model ${modeloNuevo} {`,
  )
}

// ---------------------------------------------------------------------------
// 3. Insertar @@map en los que no lo tienen.
//
// @@map va justo antes de la llave de cierre del bloque del modelo.
// ---------------------------------------------------------------------------

let anadidos = 0

for (const { tabla } of porRenombrar) {
  const modeloNuevo = mapeo.get(tabla)!
  const s = text.indexOf(`model ${modeloNuevo} {`)
  if (s === -1) continue

  const e = text.indexOf('\n}', s)
  if (e === -1) continue

  if (text.slice(s, e).includes('@@map(')) continue

  text = text.slice(0, e) + `\n  @@map("${tabla}")` + text.slice(e)
  anadidos++
}

// ---------------------------------------------------------------------------
// 4. Referencias de tipo en los campos.
//
// Renombrar `model users` a `model User` no basta: los campos que lo usaban
// como tipo siguen diciendo `users` y Prisma deja de validar. Ejemplos:
//
//   user       users?          -> user       User?
//   incidents  incidents[]     -> incidents  Incident[]
//
// El patrón ancla en el NOMBRE del campo y exige que lo que viene a
// continuación sea el tipo, así que no toca por error los @@map("users"), ni
// los valores de @default, ni los nombres de columna de @index o @relation.
//
//   ^ ( \s+ \w+ \s+ )        indent + nombre de campo + espacios
//     ( List< )?             relación many
//     VIEJO (?= [>\[\]?\s])  el nombre viejo seguido de tipo o fin de tipo
// ---------------------------------------------------------------------------

let refs = 0

for (const [tabla, modelo] of mapeo) {
  const re = new RegExp(`^(\\s+\\w+\\s+)(List<)?${tabla}(?=[>\\[\\]?\\s])`, 'gm')
  text = text.replace(re, (_m, pre: string, list: string | undefined) => {
    refs++
    return `${pre}${list ?? ''}${modelo}`
  })
}

// ---------------------------------------------------------------------------

writeFileSync(schemaPath, text, 'utf8')

console.log(
  `  fix-schema · ${mapeo.size} modelos · ${anadidos} cabeceras renombradas · ${refs} referencias corregidas`,
)

if (anadidos === 0 && refs === 0) {
  console.log('  fix-schema · el esquema ya estaba correcto')
}