// ---------------------------------------------------------------------------
// Cliente con privilegios de administracion.
//
// ESTE MODULO ESTA PROHIBIDO IMPORTARLO DESDE CODIGO DE PRODUCTO.
//
// Conecta con MIGRATION_DATABASE_URL, que es el rol `postgres` de Supabase, y ese
// rol tiene BYPASSRLS: no le aplican las politicas. Con el se lee y se escribe
// en TODAS las comunidades sin restriccion, y el aislamiento entre vecinos deja
// de existir en el mismo instante.
//
// Se separa del cliente de `db.ts` en un archivo propio, y no como una simple
// constante, por una razon concreta: que la separacion sea visible. Si las dos
// conexiones vivieran en el mismo modulo seria trivial importarlas por error sin
// que nada lo delimitara. Al estar en archivos distintos, un import de este en
// codigo de producto queda a la vista en la revision.
//
// Uso legitimo, y solo este:
//   - tests de integracion, para crear y destruir fixtures.
//   - scripts de seed y de comprobacion.
// ---------------------------------------------------------------------------

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const url = process.env.MIGRATION_DATABASE_URL

if (!url) {
  throw new Error(
    [
      'MIGRATION_DATABASE_URL no esta definida.',
      '',
      'Es la conexion con el rol postgres, y la necesitan unicamente:',
      '  - los tests de integracion, para crear y borrar fixtures',
      '  - prisma/seed.ts',
      '',
      'La aplicacion en runtime usa DATABASE_URL (rol app_runtime), que si',
      'respeta RLS. No confundirlas: con la que no toca, el aislamiento no existe.',
    ].join('\n'),
  )
}

export const admin = new PrismaClient({
  datasources: { db: { url } },

  // Log de consultas desactivado a proposito: los fixtures insertan miles de
  // filas en cada pasada y el ruido tapa lo que interesa.
  log: [{ level: 'warn', emit: 'stdout' }, { level: 'error', emit: 'stdout' }],
})

/**
 * Comprueba que este cliente tiene BYPASSRLS.
 *
 * Se usa en los tests: si `admin` de repente respetara las politicas, todos los
 * fixtures dejarian de poder crearse y la suite fallaria con errores de permisos
 * que no dicen nada sobre su causa real. Fallar aqui antes convierte un
 * diagnostico confuso en uno evidentemente relacionado.
 */
export async function assertAdminBypassesRls(): Promise<boolean> {
  const rows = await admin.$queryRaw<Array<{ bypassrls: boolean }>>`
    select rolbypassrls as bypassrls from pg_roles where rolname = session_user
  `
  return rows[0]?.bypassrls === true
}
