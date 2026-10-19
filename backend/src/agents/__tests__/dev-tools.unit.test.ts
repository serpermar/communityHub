// ---------------------------------------------------------------------------
// Dev tools de los agentes de desarrollo (unitarios, spec 17 §9).
//
// No tocan red ni base de datos: trabajan sobre un directorio temporal con
// fixtures. Lo que se comprueba es lo que hace segura la herramienta:
// solo lectura y CONFINADA a la raiz (ninguna ruta escapa).
// ---------------------------------------------------------------------------

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppError } from '../../http/errors.js'
import { DEV_TOOLS, runDevTool, type DevToolContext } from '../dev/tools.js'

let root: string
let ctx: DevToolContext

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ch-dev-'))
  ctx = { repoRoot: root }

  writeFileSync(join(root, 'a.txt'), 'hola mundo\nsegunda linea\n')
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'b.ts'), 'export const x = 1\n')
  mkdirSync(join(root, 'node_modules'))
  writeFileSync(join(root, 'node_modules', 'ignored.js'), 'esto no debe listarse\n')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('list_files', () => {
  it('lista ficheros relativos y excluye los directorios ignorados', async () => {
    const { result } = await runDevTool('list_files', {}, ctx)
    const files = (result as { files: string[] }).files

    expect(files).toContain('a.txt')
    expect(files).toContain('src/b.ts')
    expect(files.some((file) => file.includes('node_modules'))).toBe(false)
  })

  it('filtra por glob', async () => {
    const { result } = await runDevTool('list_files', { glob: '**/*.ts' }, ctx)
    expect((result as { files: string[] }).files).toEqual(['src/b.ts'])
  })
})

describe('read_file', () => {
  it('devuelve el contenido de un fichero', async () => {
    const { result } = await runDevTool('read_file', { path: 'a.txt' }, ctx)
    expect((result as { content: string }).content).toContain('hola mundo')
  })

  it('un fichero inexistente devuelve error, no lanza', async () => {
    const { result } = await runDevTool('read_file', { path: 'nope.txt' }, ctx)
    expect(result).toHaveProperty('error')
  })

  it('rechaza una ruta que escapa de la raiz con ..', async () => {
    await expect(runDevTool('read_file', { path: '../secreto.txt' }, ctx)).rejects.toBeInstanceOf(
      AppError,
    )
  })

  it('rechaza una ruta absoluta', async () => {
    await expect(runDevTool('read_file', { path: join(root, 'a.txt') }, ctx)).rejects.toThrow(
      AppError,
    )
  })
})

describe('search_repo', () => {
  it('encuentra una coincidencia con su ruta y numero de linea', async () => {
    const { result } = await runDevTool('search_repo', { pattern: 'x = 1' }, ctx)
    const matches = (result as { matches: { path: string; line: number }[] }).matches

    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ path: 'src/b.ts', line: 1 })
  })

  it('sin coincidencias devuelve una lista vacia', async () => {
    const { result } = await runDevTool('search_repo', { pattern: 'zzz-no-existe' }, ctx)
    expect((result as { matches: unknown[] }).matches).toEqual([])
  })
})

describe('catalogo', () => {
  it('expone exactamente las tres tools de solo lectura', () => {
    expect(DEV_TOOLS.map((tool) => tool.name)).toEqual(['list_files', 'read_file', 'search_repo'])
  })

  it('rechaza una herramienta que no existe', async () => {
    await expect(runDevTool('write_file', {}, ctx)).rejects.toThrow(AppError)
  })

  it('rechaza una ruta que escapa con ..', async () => {
    await expect(runDevTool('read_file', { path: '../fuera.txt' }, ctx)).rejects.toBeInstanceOf(
      AppError,
    )
  })
})
