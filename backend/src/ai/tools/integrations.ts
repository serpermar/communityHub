// ---------------------------------------------------------------------------
// Tool de meteorologia (M-7).
//
// La unica tool NUEVA del bloque 16. Reutiliza `integrations.getWeather` (el
// mismo servicio que la ruta del bloque 12, EXT-2/EXT-4), asi que hereda su
// comportamiento degradado: sin proveedor o sin coordenadas devuelve
// `{ data: null, meta: { reason } }` en vez de fallar. El modelo explica eso en
// vez de inventarse el tiempo.
//
// No hay clave de API: Open-Meteo es anonimo, y por eso esta tool no es
// `sensitive` y SÍ se ofrece por MCP.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import * as integrations from '../../integrations/service.js'
import { ALL_ROLES, defineTool, type ToolDefinition } from './registry.js'

export const integrationTools: ToolDefinition[] = [
  defineTool({
    name: 'get_weather',
    description:
      'El tiempo actual y de hoy en la comunidad (temperatura, condición, máximas y mínimas). Puede venir degradado si el servicio externo no está disponible.',
    roles: ALL_ROLES,
    requiresCommunity: true,
    schema: z.object({}).strict(),
    async run(_args, ctx) {
      const weather = await integrations.getWeather(ctx.userId, ctx.communityId as string)
      return { result: weather }
    },
  }),
]
