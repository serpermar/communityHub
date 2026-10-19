// ---------------------------------------------------------------------------
// Tools de finanzas.
//
// Solo ADMIN, igual que las rutas del bloque 09 (`requireCommunityRole('ADMIN')`
// y no PRESIDENT): un dato economico no se abre a la presidencia por el hecho de
// serlo. La whitelist por rol (AI-9) es lo que impide que un vecino las vea en
// `GET /ai/tools`, y `preview` lo vuelve a comprobar.
//
// Los esquemas de argumentos son los validadores del bloque 09.
// ---------------------------------------------------------------------------

import { z } from 'zod'
import * as finance from '../../finance/service.js'
import { expensesQuerySchema, invoicesQuerySchema } from '../../finance/validators.js'
import { defineTool, type ToolDefinition } from './registry.js'

const ADMIN = ['ADMIN'] as const

export const financeTools: ToolDefinition[] = [
  defineTool({
    name: 'get_expenses',
    description: 'Lista los gastos de la comunidad, con filtros opcionales por fecha, categoría o importe.',
    roles: [...ADMIN],
    requiresCommunity: true,
    sensitive: true,
    schema: expensesQuerySchema,
    async run(args: z.infer<typeof expensesQuerySchema>, ctx) {
      const page = await finance.listExpenses(ctx.userId, ctx.communityId as string, args)
      return { result: page.items, citations: page.items.map((expense) => expense.id) }
    },
  }),

  defineTool({
    name: 'get_invoices',
    description: 'Lista las cuotas o recibos de la comunidad, con filtro opcional por estado.',
    roles: [...ADMIN],
    requiresCommunity: true,
    sensitive: true,
    schema: invoicesQuerySchema,
    async run(args: z.infer<typeof invoicesQuerySchema>, ctx) {
      const page = await finance.listInvoices(ctx.userId, ctx.communityId as string, args)
      return { result: page.items, citations: page.items.map((invoice) => invoice.id) }
    },
  }),

  defineTool({
    name: 'get_finance_summary',
    description: 'Resumen financiero de la comunidad: ingresos, gastos y saldo.',
    roles: [...ADMIN],
    requiresCommunity: true,
    sensitive: true,
    schema: z.object({}).strict(),
    async run(_args, ctx) {
      const summary = await finance.financeSummary(ctx.userId, ctx.communityId as string)
      return { result: summary }
    },
  }),
]
