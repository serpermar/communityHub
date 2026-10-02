// ---------------------------------------------------------------------------
// withContext · el nucleo del aislamiento entre comunidades.
//
// Cada peticion entra en una transaccion y, DENTRO de ella, fija dos variables
// de sesion que leen las politicas de 02_rls.sql:
//
//   app.current_user_id      -> app_current_user_id()      (app_role_in, ...)
//   app.current_community_id -> app_current_community_id()
//
// `set_config(..., true)` equivale a SET LOCAL: la variable existe solo durante
// esa transaccion. Es imprescindible que sea LOCAL y no SET normal. Con SET,
// el valor se queda pegado a la conexion del pool y la siguiente peticion, que
// reutiliza esa misma conexion, hereda el contexto de la anterior. Ese fallo
// deja a un vecino viendo las incidencias de otro, y no aparece en ningun
// test mientras cada peticion use una conexion nueva.
//
// Por eso SIEMPRE se devuelve el callback, y nunca se hace prisma.x fuera de el.
// ---------------------------------------------------------------------------

import { Prisma } from '@prisma/client'
import { prisma } from './db.js'

export type Context = {
  userId: string
  communityId: string
}

export async function withContext<T>(
  ctx: Context,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.current_user_id', ${ctx.userId}, true)`
    await tx.$executeRaw`select set_config('app.current_community_id', ${ctx.communityId}, true)`

    return fn(tx)
  })
}

// ---------------------------------------------------------------------------
// whoami · lee el contexto desde la propia base de datos.
//
// Sirve para dos cosas: depurar, y comprobar en los tests que el contexto se
// filtro como se esperaba en lugar de asumirlo.
// ---------------------------------------------------------------------------

export async function whoami() {
  return withContext(
    { userId: '00000000-0000-0000-0000-000000000000', communityId: '00000000-0000-0000-0000-000000000000' },
    (tx) =>
      tx.$queryRaw<Array<{ user_id: string | null; community_id: string | null; role: string | null }>>`
        select
          app_current_user_id()      as user_id,
          app_current_community_id() as community_id,
          app_role_in(app_current_community_id()) as role
      `,
  )
}