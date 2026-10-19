// ---------------------------------------------------------------------------
// Tools de incidencias.
//
// Tres de lectura y una de escritura "diferida": `prepare_incident_draft` no
// crea nada, devuelve una propuesta que un humano tiene que confirmar por su
// propia ruta (AI-2). Es la unica tool que llama a un LLM por dentro (el
// clasificador).
// ---------------------------------------------------------------------------

import { z } from 'zod'
import * as incidents from '../../incidents/service.js'
import { listQuerySchema } from '../../incidents/validators.js'
import { classifyIncident } from '../classifier.js'
import { ALL_ROLES, defineTool, type ToolDefinition } from './registry.js'

export const incidentTools: ToolDefinition[] = [
  defineTool({
    name: 'get_incidents',
    description:
      'Lista las incidencias de la comunidad, con filtros opcionales por estado, prioridad, categoría o texto.',
    roles: ALL_ROLES,
    requiresCommunity: true,
    schema: listQuerySchema,
    async run(args: z.infer<typeof listQuerySchema>, ctx) {
      const list = await incidents.listIncidents(ctx.userId, ctx.communityId as string, args)
      return { result: list.items, citations: list.items.map((incident) => incident.id) }
    },
  }),

  defineTool({
    name: 'get_open_incidents',
    description: 'Lista las incidencias abiertas (estado OPEN) de la comunidad.',
    roles: ALL_ROLES,
    requiresCommunity: true,
    schema: z.object({ limit: listQuerySchema.shape.limit }).strict(),
    async run(args: { limit?: number }, ctx) {
      const list = await incidents.listIncidents(ctx.userId, ctx.communityId as string, {
        status: 'OPEN',
        limit: args.limit,
      })
      return { result: list.items, citations: list.items.map((incident) => incident.id) }
    },
  }),

  defineTool({
    name: 'get_incident',
    description: 'Datos de una incidencia concreta por su id.',
    roles: ALL_ROLES,
    requiresCommunity: true,
    schema: z.object({ incidentId: z.string().uuid() }).strict(),
    async run(args: { incidentId: string }, ctx) {
      const incident = await incidents.getIncident(
        ctx.userId,
        ctx.communityId as string,
        args.incidentId,
      )
      return { result: incident, citations: [incident.id] }
    },
  }),

  defineTool({
    name: 'prepare_incident_draft',
    description:
      'A partir de una descripción, propone una incidencia (categoría, prioridad, título). No crea la incidencia: el usuario tiene que confirmarla.',
    roles: ['NEIGHBOR', 'PRESIDENT', 'ADMIN'],
    requiresCommunity: true,
    sensitive: true,
    schema: z.object({ description: z.string().trim().min(3).max(2000) }).strict(),
    async run(args: { description: string }, ctx) {
      const classification = await classifyIncident(ctx.userId, args.description, ctx.client)
      return {
        result: { proposal: classification.proposal },
        tokensIn: classification.tokensIn,
        tokensOut: classification.tokensOut,
      }
    },
  }),
]
