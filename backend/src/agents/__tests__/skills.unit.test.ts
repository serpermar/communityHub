// ---------------------------------------------------------------------------
// Carga de skills (unitarios).
//
// Comprueba que las nueve skills declaradas existen de verdad en el disco, que
// tienen contenido y que sus ficheros de apoyo estan donde se dice.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import { AppError } from '../../http/errors.js'
import { SKILLS, loadAllSkills, loadSkill, skillFilesOnDisk } from '../skills.js'

describe('skills', () => {
  it('hay 9 skills declaradas', () => {
    expect(SKILLS).toHaveLength(9)
  })

  it('cada SKILL.md existe y no esta vacio', () => {
    for (const loaded of loadAllSkills()) {
      expect(loaded.body.trim().length, loaded.name).toBeGreaterThan(0)
    }
  })

  it('la skill de incidencias trae sus playbooks y ejemplos', () => {
    const files = skillFilesOnDisk('incident-management')
    expect(files).toContain('SKILL.md')
    expect(files).toContain('examples.md')
    expect(files).toContain('playbooks')

    const skill = loadSkill('incident-management')
    expect(skill.files).toEqual(
      expect.arrayContaining(['playbooks/triage.md', 'playbooks/escalado.md', 'playbooks/cierre.md', 'examples.md']),
    )
  })

  it('loadSkill lanza SKILL_NOT_FOUND para una skill inexistente', () => {
    expect(() => loadSkill('no-existe')).toThrow(AppError)
  })
})
