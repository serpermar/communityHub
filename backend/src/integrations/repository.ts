// ---------------------------------------------------------------------------
// Acceso a datos del bloque 12.
//
// Es el unico sitio del modulo que toca `communities` y `audit_logs`. Todas las
// funciones reciben el cliente de transaccion, nunca el singleton: por
// construccion no se puede leer ni escribir nada fuera del contexto de RLS.
//
// Se leen cuatro cosas y se escriben dos:
//
//   - Lectura: la comunidad (incluidas coordenadas y direccion) para los tres
//     endpoints. La politica `communities_select_member` ya limita a lo que el
//     actor puede ver; que salga vacio es "no existe para mi".
//   - Escritura de coordenadas: `updateMany` y no `update`, por el mismo motivo
//     que en el modulo de comunidades (una fila no visible no es un P2025, es
//     cero filas afectadas).
//   - Escritura de auditoria: `community.geocode`. Va aqui, con el `INSERT`
//     explicito, igual que hace la IA (AI-13): el `audit_logs` no tiene una capa
//     generica y un trigger, lo escribe el modulo.
//
// `latitude`/`longitude` son `Decimal?` en Prisma. Se convierten a `number` al
// leer (son coordenadas, no importes) y se escriben como `number`, dejando que
// Prisma los serialice al `numeric(9,6)`.
// ---------------------------------------------------------------------------

import { type Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

export type CommunityRow = {
  id: string
  name: string
  address_line1: string
  city: string
  province: string | null
  postal_code: string | null
  country: string
  latitude: Prisma.Decimal | null
  longitude: Prisma.Decimal | null
  timezone: string
}

const COMMUNITY_FIELDS = {
  id: true,
  name: true,
  address_line1: true,
  city: true,
  province: true,
  postal_code: true,
  country: true,
  latitude: true,
  longitude: true,
  timezone: true,
} as const

/** La comunidad del contexto. `null` si no existe, esta borrada o no es visible. */
export async function findCommunity(tx: Tx, communityId: string): Promise<CommunityRow | null> {
  const row = await tx.communities.findFirst({
    where: { id: communityId, deleted_at: null },
    select: COMMUNITY_FIELDS,
  })

  return row
}

/**
 * Escribe las coordenadas. Devuelve el numero de filas afectadas para que el
 * service pueda distinguir "no hay comunidad" de "escrito".
 */
export async function updateCoordinates(
  tx: Tx,
  communityId: string,
  latitude: number,
  longitude: number,
): Promise<number> {
  const result = await tx.communities.updateMany({
    where: { id: communityId, deleted_at: null },
    data: { latitude, longitude, updated_at: new Date() },
  })

  return result.count
}

/** Deja constancia del geocodificado (EXT-14). */
export async function insertGeocodeAudit(
  tx: Tx,
  input: {
    actorId: string
    actorRole: string | null
    communityId: string
    metadata: unknown
  },
): Promise<void> {
  await tx.$executeRaw`
    insert into audit_logs (actor_id, actor_role, community_id, action, entity, entity_id, metadata)
    values (
      ${input.actorId}::uuid,
      ${input.actorRole},
      ${input.communityId}::uuid,
      'community.geocode',
      'communities',
      ${input.communityId},
      ${JSON.stringify(input.metadata)}::jsonb
    )
  `
}
