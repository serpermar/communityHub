// ---------------------------------------------------------------------------
// Tools de zonas comunes y reservas.
//
// Los esquemas de argumentos reutilizan los validadores de cada modulo (05/06) en
// vez de duplicarlos: si el modulo cambia un filtro, la tool lo hereda. Ademas,
// asi el objeto que recibe el service tiene exactamente su tipo.
//
// `get_reservations` respeta la visibilidad por rol de R-5 (un vecino ve las
// suyas; la gestion ve las de todos) porque llama al service, que ya la aplica.
// `get_user_reservations` no exige comunidad: es "mis reservas" en todas mis
// comunidades y el service ya lo resuelve con el actor.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import * as areas from '../../common-areas/service.js'
import { availabilityQuerySchema } from '../../common-areas/validators.js'
import * as reservations from '../../reservations/service.js'
import { listQuerySchema as reservationsQuerySchema, meQuerySchema } from '../../reservations/validators.js'
import { ALL_ROLES, defineTool, type ToolDefinition } from './registry.js'

const availabilityArgsSchema = z
  .object({
    areaId: z.string().uuid(),
    date: availabilityQuerySchema.shape.date,
  })
  .strict()

export const areaTools: ToolDefinition[] = [
  defineTool({
    name: 'get_common_areas',
    description: 'Devuelve las zonas comunes de la comunidad (nombre, tipo, si necesita reserva) y su disponibilidad general.',
    roles: ALL_ROLES,
    requiresCommunity: true,
    schema: z.object({}).strict(),
    async run(_args, ctx) {
      const list = await areas.listCommonAreas(ctx.userId, ctx.communityId as string)
      return { result: list, citations: list.map((area) => area.id) }
    },
  }),

  defineTool({
    name: 'get_availability',
    description: 'Consulta la disponibilidad de una zona común en una fecha concreta.',
    roles: ALL_ROLES,
    requiresCommunity: true,
    schema: availabilityArgsSchema,
    async run(args: z.infer<typeof availabilityArgsSchema>, ctx) {
      const availability = await areas.getAvailability(ctx.userId, ctx.communityId as string, args.areaId, {
        date: args.date,
      })
      return { result: availability, citations: [args.areaId] }
    },
  }),

  defineTool({
    name: 'get_reservations',
    description: 'Lista las reservas de zonas comunes que puede ver el usuario, con filtros opcionales.',
    roles: ALL_ROLES,
    requiresCommunity: true,
    schema: reservationsQuerySchema,
    async run(args: z.infer<typeof reservationsQuerySchema>, ctx) {
      const page = await reservations.listReservations(ctx.userId, ctx.communityId as string, args)
      return { result: page.items, citations: page.items.map((reservation) => reservation.id) }
    },
  }),

  defineTool({
    name: 'get_user_reservations',
    description: 'Lista las reservas del propio usuario en todas sus comunidades.',
    roles: ALL_ROLES,
    requiresCommunity: false,
    schema: meQuerySchema,
    async run(args: z.infer<typeof meQuerySchema>, ctx) {
      const page = await reservations.listMyReservations(ctx.userId, args)
      return { result: page.items, citations: page.items.map((reservation) => reservation.id) }
    },
  }),
]
