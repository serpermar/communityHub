// ---------------------------------------------------------------------------
// Validadores de los agentes (M-10).
// ---------------------------------------------------------------------------

import { z } from 'zod'

export const runAgentBodySchema = z
  .object({
    communityId: z.string().uuid(),
    message: z.string().trim().min(3).max(2000),
  })
  .strict()

export type RunAgentBodyInput = z.infer<typeof runAgentBodySchema>
