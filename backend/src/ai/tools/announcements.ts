// ---------------------------------------------------------------------------
// Tools de anuncios.
//
// Solo lectura. El esquema de argumentos es el validador del bloque 07; el
// service ya aplica la ventana de publicacion y el alcance por rol.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import * as announcements from '../../announcements/service.js'
import { listQuerySchema } from '../../announcements/validators.js'
import { ALL_ROLES, defineTool, type ToolDefinition } from './registry.js'

export const announcementTools: ToolDefinition[] = [
  defineTool({
    name: 'get_announcements',
    description:
      'Lista los avisos publicados de la comunidad, con filtro opcional por tipo y texto.',
    roles: ALL_ROLES,
    requiresCommunity: true,
    schema: listQuerySchema,
    async run(args: z.infer<typeof listQuerySchema>, ctx) {
      const page = await announcements.listAnnouncements(
        ctx.userId,
        ctx.communityId as string,
        args,
      )
      return { result: page.items, citations: page.items.map((announcement) => announcement.id) }
    },
  }),
]
