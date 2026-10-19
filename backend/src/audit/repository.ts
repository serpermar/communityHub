// ---------------------------------------------------------------------------
// Auditoria compartida (M-8).
//
// `audit_logs` es append-only y la escriben varios modulos: el asistente por cada
// tool que ejecuta (AI-13) y, desde el bloque 16, el adaptador MCP por cada tool
// que invoca un agente externo, y los agentes de runtime por cada `run`.
//
// Antes de esto, el INSERT vivia dentro de `ai/repository.ts`. Se saca aqui para
// que MCP y agentes no dependan del modulo de IA solo por una linea de SQL, y
// para que la forma de la fila (que columnas, en que orden) este en un unico
// sitio. No hay logica de negocio: es un INSERT.
// ---------------------------------------------------------------------------

import { type Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

export type AuditInput = {
  actorId: string
  actorRole: string | null
  agentName: string
  communityId: string | null
  action: string
  entity: string
  entityId: string | null
  metadata: unknown
}

export async function insertAudit(tx: Tx, input: AuditInput): Promise<void> {
  await tx.$executeRaw`
    insert into audit_logs (actor_id, actor_role, agent_name, community_id, action, entity, entity_id, metadata)
    values (
      ${input.actorId}::uuid,
      ${input.actorRole},
      ${input.agentName},
      ${input.communityId}::uuid,
      ${input.action},
      ${input.entity},
      ${input.entityId},
      ${JSON.stringify(input.metadata)}::jsonb
    )
  `
}
