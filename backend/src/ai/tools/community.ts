// ---------------------------------------------------------------------------
// Tools de comunidad y miembros.
//
// Las dos exigen comunidad. `get_community` llama a `communities.getOne` y
// `get_members` a `members.listMembers`: los mismos services que usan las rutas
// del bloque 03, con las mismas reglas de autorizacion (D-3). No hay SQL aqui.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import * as communities from '../../communities/service.js'
import * as members from '../../members/service.js'
import { ALL_ROLES, defineTool, type ToolDefinition } from './registry.js'

const ROLES = ['NEIGHBOR', 'PROVIDER', 'ADMIN', 'PRESIDENT'] as const

export const communityTools: ToolDefinition[] = [
  defineTool({
    name: 'get_community',
    description:
      'Datos de la comunidad actual: nombre, dirección, ciudad, provincia, código postal y datos de registro.',
    roles: ALL_ROLES,
    requiresCommunity: true,
    schema: z.object({}).strict(),
    async run(_args, ctx) {
      const community = await communities.getOne(
        ctx.userId,
        ctx.communityId as string,
        ctx.role as string,
      )
      return { result: community, citations: [community.id] }
    },
  }),

  defineTool({
    name: 'get_members',
    description:
      'Lista los miembros de la comunidad. Opcionalmente filtra por rol (NEIGHBOR, PROVIDER, ADMIN, PRESIDENT).',
    roles: ALL_ROLES,
    requiresCommunity: true,
    schema: z.object({ role: z.enum(ROLES).optional() }).strict(),
    async run(args: { role?: (typeof ROLES)[number] }, ctx) {
      const list = await members.listMembers(ctx.userId, ctx.communityId as string)
      const filtered = args.role ? list.filter((member) => member.role === args.role) : list
      return { result: filtered, citations: filtered.map((member) => member.id) }
    },
  }),
]
