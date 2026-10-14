// ---------------------------------------------------------------------------
// El registro de tools (AI-1, AI-9, AI-10).
//
// Una tool es: un nombre, una descripcion para el modelo, los roles que pueden
// usarla, un esquema zod de sus argumentos y una funcion que la ejecuta. Nada
// mas. No hay forma de que el modelo pida SQL: la unica superficie es esta lista
// cerrada, y lo que no este aqui no se puede invocar.
//
// El esquema zod cumple dos papeles a la vez:
//
//   1. Valida los argumentos que propone el modelo (o el cliente en `preview`).
//      Un parametro inventado no llega nunca a la funcion.
//   2. Se convierte a JSON-schema y es lo que se le ofrece al modelo, para que
//      sepa que puede pedir. Una sola declaracion, dos usos.
//
// `requiresCommunity` no es decorativo: una tool que la exige y recibe un
// contexto sin comunidad falla con 403 antes de tocar ningun service. Y el
// `communityId` NUNCA es un argumento de la tool (AI-10): sale del contexto del
// actor, asi que un modelo no puede pedir "los gastos de otra comunidad".
// ---------------------------------------------------------------------------

import { z } from 'zod'
import { AppError, badRequest } from '../../http/errors.js'
import type { LLMClient, ToolSpec } from '../llm/client.js'
import type { CommunityRole } from '../types.js'

/** Lo que una tool sabe del actor. Ni un campo mas. */
export type ToolContext = {
  userId: string
  communityId: string | null
  role: CommunityRole | null
  client: LLMClient | null
}

/** El resultado de una tool. `citations` son los ids de lo que se ha consultado. */
export type ToolResult = {
  result: unknown
  citations?: string[]
  /** Tokens gastados por la tool si llamo a un LLM (p.ej. preparar un borrador). */
  tokensIn?: number
  tokensOut?: number
}

// `any` en `args` es deliberado: cada tool concreta declara el tipo real con el
// que trabaja, y el unico camino hasta `run` (runTool) ya ha validado el dato con
// su esquema zod. Tiparlo aqui como `unknown` obligaria a cada tool a reafirmar
// lo que el registro ya garantiza.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type ToolDefinition = {
  name: string
  description: string
  roles: CommunityRole[]
  requiresCommunity: boolean
  schema: z.ZodType
  parameters: Record<string, unknown>
  run: (args: any, ctx: ToolContext) => Promise<ToolResult>
}

/** Todos los roles de comunidad, para no repetir la lista en cada tool. */
export const ALL_ROLES: CommunityRole[] = ['NEIGHBOR', 'PROVIDER', 'ADMIN', 'PRESIDENT']

/** La tool tal como se le describe al modelo. */
function toSpec(tool: ToolDefinition): ToolSpec {
  return { name: tool.name, description: tool.description, parameters: tool.parameters }
}

/** Convierte un esquema zod a JSON-schema para el modelo, sin `$schema`. */
function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>
  delete generated.$schema
  return generated
}

/**
 * Declara una tool. Calcula `parameters` una vez, al cargar el modulo, y no en
 * cada peticion.
 */
export function defineTool(
  definition: Omit<ToolDefinition, 'parameters'> & { run: ToolDefinition['run'] },
): ToolDefinition {
  return { ...definition, parameters: jsonSchema(definition.schema) }
}

// --- Consultas sobre una lista de tools --------------------------------------

export function toolSpecs(tools: readonly ToolDefinition[]): ToolSpec[] {
  return tools.map(toSpec)
}

/** Las tools que puede usar un rol. Un rol nulo (sin comunidad) no ve ninguna. */
export function toolsForRole(tools: readonly ToolDefinition[], role: CommunityRole | null): ToolDefinition[] {
  if (!role) return []
  return tools.filter((tool) => tool.roles.includes(role))
}

/**
 * Las tools que puede usar al menos uno de los roles dados (union). Es lo que
 * devuelve `GET /ai/tools`: el catalogo del rol MENOS restrictivo del actor.
 */
export function toolsForRoles(tools: readonly ToolDefinition[], roles: ReadonlySet<CommunityRole>): ToolDefinition[] {
  if (roles.size === 0) return []
  return tools.filter((tool) => tool.roles.some((role) => roles.has(role)))
}

export function findTool(tools: readonly ToolDefinition[], name: string): ToolDefinition | undefined {
  return tools.find((tool) => tool.name === name)
}

/**
 * Ejecuta una tool por nombre, validando argumentos, comunidad y rol.
 *
 * Los errores son `AppError` con los codigos del contrato de IA: en `preview`
 * salen tal cual al cliente; en el chat los captura el asistente y se los cuenta
 * al modelo como resultado de la tool, sin abortar la conversacion.
 */
export async function runTool(
  tools: readonly ToolDefinition[],
  name: string,
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = findTool(tools, name)

  if (!tool) {
    throw new AppError(404, 'AI_TOOL_UNKNOWN', `La herramienta "${name}" no existe.`)
  }

  if (tool.requiresCommunity && !ctx.communityId) {
    throw new AppError(
      403,
      'AI_TOOL_FORBIDDEN',
      `La herramienta "${name}" necesita una comunidad, y esta conversación no tiene ninguna.`,
    )
  }

  if (!ctx.role || !tool.roles.includes(ctx.role)) {
    throw new AppError(403, 'AI_TOOL_FORBIDDEN', `Tu rol no puede usar la herramienta "${name}".`)
  }

  const parsed = tool.schema.safeParse(args)

  if (!parsed.success) {
    throw badRequest(`Los argumentos de "${name}" no son válidos.`, parsed.error.issues)
  }

  return tool.run(parsed.data, ctx)
}
