// ---------------------------------------------------------------------------
// Carga de skills (M-9).
//
// Una skill es una carpeta con un `SKILL.md` (y, si hace falta, ficheros de
// apoyo). No es codigo: es conocimiento que se le inyecta a un agente como
// contexto. Este modulo las declara (que existen) y las lee del disco.
//
// Por que declararlas tambien en codigo y no solo en el sistema de ficheros: el
// registro de agentes referencia skills por nombre, y un nombre mal escrito debe
// fallar en tiempo de construccion (un test de sincronia) y no en produccion,
// cuando un agente intenta cargar una skill que no existe.
//
// La ruta se calcula con `import.meta.url` y sube tres niveles hasta la raiz del
// repositorio: tanto en `src/agents/` (desarrollo) como en `dist/agents/`
// (compilado) el directorio `skills/` cuelga de la misma raiz.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppError } from '../http/errors.js'

export type SkillDefinition = {
  name: string
  title: string
  description: string
  /** Ficheros, ademas de SKILL.md, que forman la skill. */
  extraFiles: string[]
}

export const SKILLS: SkillDefinition[] = [
  {
    name: 'community-management',
    title: 'Gestión de comunidad',
    description: 'Comunidades, membresías, invitaciones y roles.',
    extraFiles: [],
  },
  {
    name: 'incident-management',
    title: 'Gestión de incidencias',
    description: 'Registro, triage, escalado y cierre de incidencias.',
    extraFiles: ['playbooks/triage.md', 'playbooks/escalado.md', 'playbooks/cierre.md', 'examples.md'],
  },
  {
    name: 'reservations',
    title: 'Reservas de zonas comunes',
    description: 'Disponibilidad, creación y cancelación de reservas.',
    extraFiles: [],
  },
  {
    name: 'finance',
    title: 'Finanzas de la comunidad',
    description: 'Gastos, cuotas/recibos y resumen financiero.',
    extraFiles: [],
  },
  {
    name: 'authentication',
    title: 'Autenticación y sesiones',
    description: 'Registro, login, refresh y revocación de sesiones.',
    extraFiles: [],
  },
  {
    name: 'database',
    title: 'Base de datos y RLS',
    description: 'Acceso a datos, aislamiento entre comunidades y migraciones.',
    extraFiles: [],
  },
  {
    name: 'security',
    title: 'Seguridad',
    description: 'Autorización, validación y trato del contenido ajeno.',
    extraFiles: [],
  },
  {
    name: 'testing',
    title: 'Testing',
    description: 'Tests unitarios, de integración y regla de los fixtures.',
    extraFiles: [],
  },
  {
    name: 'documentation',
    title: 'Documentación',
    description: 'Flujo SDD, specs y actualización de la documentación.',
    extraFiles: [],
  },
]

/** El directorio raiz de las skills (`<repo>/skills`). */
export function skillsDirectory(): string {
  return fileURLToPath(new URL('../../../skills/', import.meta.url))
}

function skillPath(def: SkillDefinition, file: string): string {
  return join(skillsDirectory(), def.name, file)
}

export type LoadedSkill = {
  name: string
  title: string
  description: string
  /** El contenido de `SKILL.md`. */
  body: string
  /** Los ficheros de apoyo, relativos a la carpeta de la skill. */
  files: string[]
}

export function findSkill(name: string): SkillDefinition | undefined {
  return SKILLS.find((skill) => skill.name === name)
}

/** Carga una skill por nombre. Lanza `SKILL_NOT_FOUND` si no existe o falta su fichero. */
export function loadSkill(name: string): LoadedSkill {
  const def = findSkill(name)

  if (!def) {
    throw new AppError(404, 'SKILL_NOT_FOUND', `La skill "${name}" no existe.`)
  }

  const main = skillPath(def, 'SKILL.md')

  if (!existsSync(main)) {
    throw new AppError(404, 'SKILL_NOT_FOUND', `La skill "${name}" no tiene SKILL.md.`)
  }

  return {
    name: def.name,
    title: def.title,
    description: def.description,
    body: readFileSync(main, 'utf8'),
    files: def.extraFiles.filter((file) => existsSync(skillPath(def, file))),
  }
}

export function loadAllSkills(): LoadedSkill[] {
  return SKILLS.map((skill) => loadSkill(skill.name))
}

/** Los nombres de los ficheros que hay realmente en la carpeta de una skill. */
export function skillFilesOnDisk(name: string): string[] {
  const dir = join(skillsDirectory(), name)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
}
