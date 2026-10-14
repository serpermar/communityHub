// ---------------------------------------------------------------------------
// Tool de documentos.
//
// Solo metadatos: NUNCA el binario ni la URL firmada. Un documento de la
// comunidad se consulta por su ruta propia; el asistente dice que existe y como
// se llama, y la descarga sigue teniendo su autorizacion de siempre.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import * as documents from '../../documents/service.js'
import { listQuerySchema } from '../../documents/validators.js'
import { ALL_ROLES, defineTool, type ToolDefinition } from './registry.js'

export const documentTools: ToolDefinition[] = [
  defineTool({
    name: 'get_documents',
    description: 'Lista los documentos de la comunidad (nombre, categoría, fecha), sin el contenido.',
    roles: ALL_ROLES,
    requiresCommunity: true,
    schema: listQuerySchema,
    async run(args: z.infer<typeof listQuerySchema>, ctx) {
      const page = await documents.listDocuments(ctx.userId, ctx.communityId as string, args)
      return { result: page.items, citations: page.items.map((document) => document.id) }
    },
  }),
]
