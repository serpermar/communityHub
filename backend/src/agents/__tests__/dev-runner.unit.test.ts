// ---------------------------------------------------------------------------
// Runner de agentes de desarrollo (unitarios, spec 17 §9).
//
// Sin red y sin base de datos: el LLM se sustituye por `FakeLLMClient` y las
// dev tools leen un directorio temporal. Se comprueba el bucle de tool calling,
// la degradacion sin proveedor (modo prompt) y que solo acepta agentes de
// desarrollo.
// ---------------------------------------------------------------------------

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FakeLLMClient } from '../../ai/llm/fake.js'
import { AppError } from '../../http/errors.js'
import { buildDevPrompt, runDevAgent } from '../dev/runner.js'
import { findAgent } from '../registry.js'

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ch-dev-'))
  writeFileSync(join(root, 'notes.txt'), 'contenido de prueba\n')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('runDevAgent', () => {
  it('hace el bucle de tool calling y devuelve la propuesta', async () => {
    const client = new FakeLLMClient([
      { content: '', toolCalls: [{ id: '1', name: 'read_file', args: { path: 'notes.txt' } }], tokensIn: 5, tokensOut: 0, model: 'fake' },
      { content: 'Propuesta concreta.', toolCalls: [], tokensIn: 2, tokensOut: 3, model: 'fake' },
    ])

    const result = await runDevAgent('testing', { instruction: 'lee notes.txt', repoRoot: root, client })

    expect(result.mode).toBe('llm')
    expect(result.answer).toBe('Propuesta concreta.')
    expect(result.toolCalls).toEqual([{ name: 'read_file', args: { path: 'notes.txt' } }])
    expect(result.tokensIn).toBe(7)
    expect(result.tokensOut).toBe(3)

    expect(client.calls).toHaveLength(2)
    const toolMessage = client.calls[1]?.messages.find((message) => message.role === 'tool')
    expect(toolMessage?.content).toContain('contenido de prueba')
  })

  it('sin proveedor devuelve el prompt compuesto (modo prompt)', async () => {
    const result = await runDevAgent('testing', { instruction: 'algo', client: null })

    expect(result.mode).toBe('prompt')
    expect(result.answer).toContain('Agente de testing')
    expect(result.answer).toContain('list_files')
  })

  it('rechaza agentes de runtime e inexistentes', async () => {
    await expect(runDevAgent('community', { instruction: 'x', client: null })).rejects.toBeInstanceOf(AppError)
    await expect(runDevAgent('no-existe', { instruction: 'x', client: null })).rejects.toBeInstanceOf(AppError)
  })

  it('corta el bucle al tope de iteraciones', async () => {
    const client = new FakeLLMClient(() => ({
      content: '',
      toolCalls: [{ id: 'loop', name: 'read_file', args: { path: 'notes.txt' } }],
      tokensIn: 1,
      tokensOut: 0,
      model: 'fake',
    }))

    const result = await runDevAgent('testing', { instruction: 'insiste', repoRoot: root, client, maxIterations: 1 })

    expect(result.answer).toBe('No he podido completar la propuesta con la informacion leida.')
  })
})

describe('buildDevPrompt', () => {
  it('incluye identidad, skill y las tres herramientas de lectura', () => {
    const agent = findAgent('testing')
    if (!agent) throw new Error('falta el agente testing en el registro')

    const prompt = buildDevPrompt(agent)

    expect(prompt).toContain('Agente de testing')
    expect(prompt).toContain('## Skill:')
    expect(prompt).toContain('list_files')
    expect(prompt).toContain('read_file')
    expect(prompt).toContain('search_repo')
  })
})
