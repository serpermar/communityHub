// ---------------------------------------------------------------------------
// Servidor MCP (M-2, M-4, M-5, M-6, M-8).
//
// Traduce el catalogo de tools del backend a un servidor MCP. Tres reglas fijan
// lo que un agente externo puede hacer:
//
//   1. SOLO tools de solo lectura. Las marcadas `sensitive` (finanzas, borrador
//     de incidencia) se FILTRAN: no aparecen ni se pueden llamar (M-4, M-6).
//   - Solo las tools que permite el rol del token (M-3, M-5).
//   - La comunidad sale del token, nunca de los argumentos.
//
// Cada invocacion se ejecuta dentro de `withContext` (RLS) y deja una fila en
// `audit_logs` con `agent_name: 'mcp'` y `action: 'mcp.tool_call'` (M-8).
// ---------------------------------------------------------------------------

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { AppError } from '../http/errors.js'
import { withContext } from '../context.js'
import { insertAudit } from '../audit/repository.js'
import { runTool } from '../ai/tools/index.js'
import { mcpToolsFor } from './tools.js'
import type { McpSessionPayload } from './session.js'

export { mcpToolsFor } from './tools.js'

/**
 * Construye un servidor MCP atado a una sesion (usuario + comunidad + rol).
 *
 * El servidor nace por peticion porque el actor vive en el token: no hay estado
 * compartido entre usuarios, y eso elimina la clase de fallo mas peligrosa de un
 * gateway (que una sesion herede el contexto de otra).
 */
export function buildMcpServer(session: McpSessionPayload): McpServer {
  const server = new McpServer({ name: 'communityhub', version: '1.0.0' })

  for (const tool of mcpToolsFor(session.role)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.schema,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async (args: unknown) => {
        const started = Date.now()

        try {
          const outcome = await withContext(
            { userId: session.userId, communityId: session.communityId },
            async (tx) => {
              const result = await runTool([tool], tool.name, args, {
                userId: session.userId,
                communityId: session.communityId,
                role: session.role,
                client: null,
              })

              await insertAudit(tx, {
                actorId: session.userId,
                actorRole: session.role,
                agentName: 'mcp',
                communityId: session.communityId,
                action: 'mcp.tool_call',
                entity: 'ai_tool',
                entityId: tool.name,
                metadata: {
                  tool: tool.name,
                  args,
                  session: session.sessionId,
                  duration_ms: Date.now() - started,
                },
              })

              return result
            },
          )

          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ result: outcome.result }) }],
          }
        } catch (error) {
          const message = error instanceof AppError ? error.message : 'La herramienta falló.'
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
            isError: true,
          }
        }
      },
    )
  }

  return server
}
