// ---------------------------------------------------------------------------
// Registro de agentes (M-10).
//
// Un agente es un actor con nombre, un conjunto de skills (conocimiento), un
// conjunto de tools (acciones) y un ambito. El registro es la fuente de verdad
// de su comportamiento; el fichero `agents/<name>.agent.md` es su "alma"
// legible, que ademas se inyecta en el system prompt en tiempo de ejecucion.
//
// Dos clases de agente:
//
//   - `runtime`: se pueden ejecutar por HTTP (`POST /api/v1/ai/agents/:name/run`)
//     y actuan sobre una comunidad. Tienen `roles` (quien puede invocarlos) y
//     `tools`.
//   - `development`: NO se ejecutan por HTTP. Documentan como trabaja quien
//     desarrolla el proyecto y solo tienen skills (fase de desarrollo, spec 17).
//     Se declaran aqui para que existan de verdad y no sean ficheros sueltos.
//
// Un test de sincronia (registry.unit.test.ts) comprueba que cada agente del
// registro tiene su fichero y que no hay ficheros de agente huérfanos.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppError } from '../http/errors.js'
import type { CommunityRole } from '../ai/types.js'

export type AgentKind = 'runtime' | 'development'

export type AgentDefinition = {
  name: string
  title: string
  description: string
  kind: AgentKind
  /** Roles de comunidad que pueden ejecutar el agente (solo `runtime`). */
  roles: CommunityRole[]
  /** Skills que se le inyectan como contexto. */
  skills: string[]
  /** Nombres de tools que puede invocar. `'all'` = todas las de su rol. */
  tools: string[] | 'all'
  /** Nombre del fichero del agente dentro de `agents/`. */
  file: string
}

export const AGENTS: AgentDefinition[] = [
  {
    name: 'community',
    title: 'Agente de comunidad',
    description: 'Resuelve consultas generales de una comunidad: sus datos, miembros, avisos, documentos y votaciones.',
    kind: 'runtime',
    roles: ['NEIGHBOR', 'PROVIDER', 'ADMIN', 'PRESIDENT'],
    skills: ['community-management', 'incident-management', 'reservations', 'finance'],
    tools: 'all',
    file: 'agents/community.agent.md',
  },
  {
    name: 'maintenance',
    title: 'Agente de mantenimiento',
    description: 'Sigue una incidencia desde que se reporta hasta que se cierra: triage, escalado y cierre.',
    kind: 'runtime',
    roles: ['ADMIN', 'PRESIDENT'],
    skills: ['incident-management'],
    tools: ['get_incidents', 'get_open_incidents', 'get_incident', 'get_common_areas', 'get_weather'],
    file: 'agents/maintenance.agent.md',
  },
  {
    name: 'finance',
    title: 'Agente de finanzas',
    description: 'Responde sobre gastos, cuotas y saldo de la comunidad. Solo ADMIN.',
    kind: 'runtime',
    roles: ['ADMIN'],
    skills: ['finance'],
    tools: ['get_expenses', 'get_invoices', 'get_finance_summary'],
    file: 'agents/finance.agent.md',
  },
  {
    name: 'documentation',
    title: 'Agente de documentación',
    description: 'Mantiene specs, README y documentación alineados con el código. Solo desarrollo.',
    kind: 'development',
    roles: [],
    skills: ['documentation'],
    tools: [],
    file: 'agents/documentation.agent.md',
  },
  {
    name: 'testing',
    title: 'Agente de testing',
    description: 'Escribe y revisa tests siguiendo la regla de sembrar con privilegio y afirmar con restricción.',
    kind: 'development',
    roles: [],
    skills: ['testing'],
    tools: [],
    file: 'agents/testing.agent.md',
  },
  {
    name: 'security',
    title: 'Agente de seguridad',
    description: 'Revisa autenticación, autorización, validación y tratamiento del contenido ajeno.',
    kind: 'development',
    roles: [],
    skills: ['security'],
    tools: [],
    file: 'agents/security.agent.md',
  },
]

export function agentsDirectory(): string {
  return fileURLToPath(new URL('../../../agents/', import.meta.url))
}

export function findAgent(name: string): AgentDefinition | undefined {
  return AGENTS.find((agent) => agent.name === name)
}

export function runtimeAgents(): AgentDefinition[] {
  return AGENTS.filter((agent) => agent.kind === 'runtime')
}

/** El texto del fichero del agente, o null si no existe. */
export function readAgentFile(agent: AgentDefinition): string | null {
  const path = join(fileURLToPath(new URL('../../../', import.meta.url)), agent.file)
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

/** Exige un agente de runtime existente; lanza `AGENT_NOT_FOUND` si no lo es. */
export function requireRuntimeAgent(name: string): AgentDefinition {
  const agent = findAgent(name)

  if (!agent || agent.kind !== 'runtime') {
    throw new AppError(404, 'AGENT_NOT_FOUND', `El agente "${name}" no existe.`)
  }

  return agent
}

/** Los ficheros `.agent.md` que hay en el disco. Usado por el test de sincronia. */
export function agentFilesOnDisk(): string[] {
  const dir = agentsDirectory()
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((file) => file.endsWith('.agent.md'))
}
