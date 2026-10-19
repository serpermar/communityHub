// ---------------------------------------------------------------------------
// El catalogo MCP (separado de `server.ts` para poder probarlo sin arrastrar el
// SDK ni la conexion a base de datos).
//
// La regla, en una linea: tools NO sensibles que el rol del token puede usar.
// ---------------------------------------------------------------------------

import { ALL_TOOLS, publicTools, type ToolDefinition } from '../ai/tools/index.js'
import type { CommunityRole } from '../ai/types.js'

export function mcpToolsFor(role: CommunityRole): ToolDefinition[] {
  return publicTools(ALL_TOOLS).filter((tool) => tool.roles.includes(role))
}
