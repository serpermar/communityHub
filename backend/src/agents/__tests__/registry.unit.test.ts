// ---------------------------------------------------------------------------
// Registro de agentes (unitarios).
//
// No toca red ni base de datos: comprueba la SINCRONIA entre el registro en
// codigo y los ficheros `agents/*.agent.md` del disco. Un nombre mal escrito o un
// agente borrado a medias debe fallar aqui, no en produccion.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import { AppError } from '../../http/errors.js'
import {
  AGENTS,
  agentFilesOnDisk,
  findAgent,
  requireRuntimeAgent,
  runtimeAgents,
} from '../registry.js'
import { findSkill } from '../skills.js'

describe('registro de agentes', () => {
  it('hay un fichero .agent.md por cada agente declarado', () => {
    const esperados = AGENTS.map((agent) => `${agent.name}.agent.md`).sort()
    expect(agentFilesOnDisk().sort()).toEqual(esperados)
  })

  it('cada agente referencia skills que existen', () => {
    for (const agent of AGENTS) {
      for (const skill of agent.skills) {
        expect(
          findSkill(skill),
          `el agente ${agent.name} referencia la skill ${skill}`,
        ).toBeDefined()
      }
    }
  })

  it('los agentes de runtime tienen al menos un rol; los de desarrollo ninguno', () => {
    for (const agent of AGENTS) {
      if (agent.kind === 'runtime') {
        expect(agent.roles.length, agent.name).toBeGreaterThan(0)
      } else {
        expect(agent.roles.length, agent.name).toBe(0)
      }
    }
  })

  it('findAgent localiza por nombre', () => {
    expect(findAgent('finance')?.name).toBe('finance')
    expect(findAgent('no-existe')).toBeUndefined()
  })

  it('runtimeAgents solo devuelve los ejecutables', () => {
    const nombres = runtimeAgents().map((a) => a.name)
    expect(nombres).toEqual(['community', 'maintenance', 'finance'])
  })

  it('requireRuntimeAgent rechaza agentes inexistentes y de desarrollo', () => {
    expect(() => requireRuntimeAgent('no-existe')).toThrow(AppError)
    expect(() => requireRuntimeAgent('testing')).toThrow(AppError)
    expect(requireRuntimeAgent('community').name).toBe('community')
  })
})
