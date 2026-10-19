// ---------------------------------------------------------------------------
// El registro de tools (unitarios).
//
// No toca base de datos: prueba la MAQUINARIA del registro con tools de mentira.
// Es donde se demuestra que la unica superficie que tiene el modelo esta cerrada:
//
//   - `runTool` rechaza un nombre desconocido (404 AI_TOOL_UNKNOWN), un rol sin
//     permiso (403 AI_TOOL_FORBIDDEN), una tool de comunidad sin comunidad (403)
//     y argumentos que no pasan el zod (400).
//   - `toolsForRole` filtra por rol y `toolsForRoles` devuelve la union.
//   - `defineTool` calcula el JSON-schema de los parametros (sin `$schema`), que
//     es lo que se le ofrece al modelo.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { AppError } from '../../http/errors.js'
import {
  ALL_ROLES,
  type ToolContext,
  type ToolDefinition,
  defineTool,
  findTool,
  publicTools,
  runTool,
  toolSpecs,
  toolsForRole,
  toolsForRoles,
} from '../tools/registry.js'

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return defineTool({
    name: overrides.name ?? 'demo',
    description: overrides.description ?? 'Una tool de mentira',
    roles: overrides.roles ?? ALL_ROLES,
    requiresCommunity: overrides.requiresCommunity ?? false,
    schema: overrides.schema ?? z.object({ n: z.number().optional() }).strict(),
    run: async (args, ctx) => ({ result: { args, ctx } }),
  })
}

const ctx: ToolContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  communityId: '22222222-2222-4222-8222-222222222222',
  role: 'NEIGHBOR',
  client: null,
}

describe('defineTool', () => {
  it('calcula el JSON-schema de los parametros sin `$schema`', () => {
    const tool = makeTool()
    expect(tool.parameters).toMatchObject({ type: 'object' })
    expect((tool.parameters as Record<string, unknown>).$schema).toBeUndefined()
  })

  it('toolSpecs describe solo nombre, descripcion y parametros', () => {
    const [spec] = toolSpecs([makeTool()])
    expect(spec).toMatchObject({ name: 'demo', description: 'Una tool de mentira' })
    expect(Object.keys(spec!).sort()).toEqual(['description', 'name', 'parameters'])
  })

  it('por defecto una tool NO es sensible', () => {
    expect(makeTool().sensitive).toBe(false)
  })

  it('`sensitive` se conserva cuando se declara', () => {
    const tool = defineTool({
      name: 'dinero',
      description: 'x',
      roles: ALL_ROLES,
      requiresCommunity: true,
      sensitive: true,
      schema: z.object({}).strict(),
      run: async () => ({ result: null }),
    })
    expect(tool.sensitive).toBe(true)
  })
})

describe('publicTools', () => {
  it('filtra las sensibles (catalogo MCP)', () => {
    const tools = [
      makeTool({ name: 'lectura' }),
      defineTool({
        name: 'escritura',
        description: 'x',
        roles: ALL_ROLES,
        requiresCommunity: true,
        sensitive: true,
        schema: z.object({}).strict(),
        run: async () => ({ result: null }),
      }),
    ]

    expect(publicTools(tools).map((t) => t.name)).toEqual(['lectura'])
  })
})

describe('toolsForRole / toolsForRoles', () => {
  const tools = [
    makeTool({ name: 'demo', roles: ALL_ROLES }),
    defineTool({
      name: 'solo_admin',
      description: 'x',
      roles: ['ADMIN'],
      requiresCommunity: true,
      schema: z.object({}).strict(),
      run: async () => ({ result: null }),
    }),
  ]

  it('un rol null no ve ninguna tool', () => {
    expect(toolsForRole([...tools], null)).toHaveLength(0)
  })

  it('un NEIGHBOR no ve la tool de ADMIN', () => {
    const names = toolsForRole([...tools], 'NEIGHBOR').map((t) => t.name)
    expect(names).toContain('demo')
    expect(names).not.toContain('solo-admin')
  })

  it('toolsForRoles devuelve la union de los roles', () => {
    const names = toolsForRoles([...tools], new Set(['NEIGHBOR', 'ADMIN'])).map((t) => t.name)
    expect(names).toContain('demo')
  })

  it('toolsForRoles sin roles no devuelve nada', () => {
    expect(toolsForRoles([...tools], new Set())).toHaveLength(0)
  })

  it('findTool localiza por nombre y undefined si no existe', () => {
    expect(findTool([...tools], 'demo')?.name).toBe('demo')
    expect(findTool([...tools], 'no-existe')).toBeUndefined()
  })
})

describe('runTool', () => {
  it('ejecuta una tool valida y devuelve su resultado', async () => {
    const tool = makeTool({ name: 'eco' })
    const outcome = await runTool([tool], 'eco', { n: 3 }, ctx)
    expect(outcome.result).toMatchObject({ args: { n: 3 } })
  })

  it('rechaza un nombre desconocido con 404 AI_TOOL_UNKNOWN', async () => {
    await expect(runTool([], 'no-existe', {}, ctx)).rejects.toMatchObject({
      status: 404,
      code: 'AI_TOOL_UNKNOWN',
    })
  })

  it('rechaza una tool de comunidad sin comunidad con 403', async () => {
    const tool = makeTool({ name: 'solo-comunidad', requiresCommunity: true })
    await expect(
      runTool([tool], 'solo-comunidad', {}, { ...ctx, communityId: null }),
    ).rejects.toMatchObject({ status: 403, code: 'AI_TOOL_FORBIDDEN' })
  })

  it('rechaza un rol sin permiso con 403', async () => {
    const tool = makeTool({ name: 'solo-admin', roles: ['ADMIN'] })
    await expect(runTool([tool], 'solo-admin', {}, ctx)).rejects.toMatchObject({
      status: 403,
      code: 'AI_TOOL_FORBIDDEN',
    })
  })

  it('rechaza un rol nulo con 403', async () => {
    const tool = makeTool({ name: 'x' })
    await expect(runTool([tool], 'x', {}, { ...ctx, role: null })).rejects.toMatchObject({ status: 403 })
  })

  it('rechaza argumentos invalidos con 400 y no llega a ejecutar la tool', async () => {
    let ejecutada = false
    const tool = defineTool({
      name: 'estricta',
      description: 'x',
      roles: ALL_ROLES,
      requiresCommunity: false,
      schema: z.object({ n: z.number() }).strict(),
      run: async () => {
        ejecutada = true
        return { result: null }
      },
    })

    await expect(runTool([tool], 'estricta', { n: 'no-es-numero' }, ctx)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    })
    expect(ejecutada).toBe(false)
  })

  it('rechaza una clave de mas en los argumentos', async () => {
    const tool = makeTool({ name: 'cerrada' })
    await expect(runTool([tool], 'cerrada', { n: 1, extra: true }, ctx)).rejects.toBeInstanceOf(AppError)
  })
})
