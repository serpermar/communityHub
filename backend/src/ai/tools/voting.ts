// ---------------------------------------------------------------------------
// Tools de votaciones.
//
// `get_votes` lista las votaciones publicadas de la comunidad. `get_vote_results`
// devuelve el resultado de una votacion por su id: la visibilidad por estado y
// por rol (`result_visibility`, V-12) la aplica `voting.service.voteResults`, asi
// que una votacion de otra comunidad da 404 y una no visible da 403, sin que
// aqui haya que saber nada de esas reglas.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import * as voting from '../../voting/service.js'
import { votesQuerySchema } from '../../voting/validators.js'
import { ALL_ROLES, defineTool, type ToolDefinition } from './registry.js'

export const votingTools: ToolDefinition[] = [
  defineTool({
    name: 'get_votes',
    description: 'Lista las votaciones de la comunidad, con filtro opcional por estado.',
    roles: ALL_ROLES,
    requiresCommunity: true,
    schema: votesQuerySchema,
    async run(args: z.infer<typeof votesQuerySchema>, ctx) {
      const page = await voting.listVotes(ctx.userId, ctx.communityId as string, args)
      return { result: page.items, citations: page.items.map((vote) => vote.id) }
    },
  }),

  defineTool({
    name: 'get_vote_results',
    description: 'Resultado de una votación concreta por su id, si el usuario puede verlo.',
    roles: ALL_ROLES,
    requiresCommunity: true,
    schema: z.object({ voteId: z.string().uuid() }).strict(),
    async run(args: { voteId: string }, ctx) {
      const results = await voting.voteResults(ctx.userId, args.voteId)
      return { result: results, citations: [results.id] }
    },
  }),
]
