// ---------------------------------------------------------------------------
// Acceso a datos del dashboard.
//
// Un unico `$queryRaw` a `app_community_dashboard()`. No hay nada que mapear a
// mano: la funcion ya devuelve el contrato entero como `jsonb` con las claves en
// camelCase y los importes como numeros (dentro de `jsonb_build_object`, un
// `numeric` de Postgres es un numero JSON, no una cadena), asi que Prisma lo
// deserializa al objeto que espera el service.
//
// Y no se lee ni una tabla directamente, a proposito: el predicado de fila de
// `incidents` (02_rls §5.4) dejaria a un NEIGHBOR contar solo SUS incidencias, y
// el de `expenses` (§5.12) es ADMIN-only. La comunidad entera solo se ve desde
// dentro de la funcion SECURITY DEFINER (DSH-2).
// ---------------------------------------------------------------------------

import { type Prisma } from '@prisma/client'

type Tx = Prisma.TransactionClient

/**
 * El dashboard de una comunidad, o `null` si la funcion no devolvio fila
 * (defensivo: la funcion siempre devuelve una, ver 02n).
 *
 * `from`/`to` van `null` cuando el cliente no los manda; los defaults (ultimos
 * 12 meses) los aplica la funcion.
 */
export async function dashboard(
  tx: Tx,
  communityId: string,
  from: string | null,
  to: string | null,
): Promise<unknown | null> {
  const rows = await tx.$queryRaw<Array<{ dashboard: unknown }>>`
    select app_community_dashboard(
      ${communityId}::uuid,
      ${from}::date,
      ${to}::date
    ) as dashboard
  `

  return rows[0]?.dashboard ?? null
}
