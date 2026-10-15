// ---------------------------------------------------------------------------
// Servicio del dashboard.
//
// La autorizacion esta DENTRO de `app_community_dashboard()` (02n), como en el
// resto de bloques: pertenencia y rol los decide el motor, en el unico sitio que
// los ve. Aqui no hay ningun `if (rol === ...)`: seria una segunda copia de una
// regla que ya esta escrita y probada en SQL.
//
// El service casi no hace nada, y es lo correcto: la funcion devuelve el
// contrato entero como `jsonb`, con las claves en camelCase y los importes como
// numeros. Reconstruirlo campo a campo en TypeScript seria reescribir el DTO en
// dos sitios y dejar que se desincronicen. Lo unico que se hace aqui es meterlo
// en el contexto de RLS y comprobar que hay fila.
// ---------------------------------------------------------------------------

import { withContext } from '../context.js'
import { notFound } from '../http/errors.js'
import * as repo from './repository.js'
import { ejecuta } from './errors.js'
import type { DashboardQueryInput } from './validators.js'

/** El dashboard tal como sale en la API (spec 13 §5.1). */
export type DashboardView = {
  community: {
    id: string
    name: string
    city: string
    neighborCount: number
    memberCount: number
  }
  incidents: {
    open: number
    inProgress: number
    pending: number
    critical: number
    byStatus: Array<{ status: string; count: number }>
    byCategory: Array<{ category: string; count: number }>
  }
  reservations: {
    upcomingCount: number
    upcoming: Array<{
      id: string
      commonAreaId: string
      commonAreaName: string | null
      startsAt: string
      endsAt: string
      status: string
      userId: string
      userName: string | null
    }>
    byMonth: Array<{ month: string; count: number }>
  }
  announcements: {
    latest: Array<{
      id: string
      title: string
      type: string
      priority: string
      isPinned: boolean
      publishAt: string
    }>
  }
  votes: {
    openCount: number
    open: Array<{ id: string; title: string; endsAt: string }>
  }
  finance: null | {
    expenseTotal: number
    expenseCount: number
    invoiceOpenAmount: number
    invoicePendingCount: number
    invoiceOverdueCount: number
    expensesByMonth: Array<{ month: string; total: number }>
  }
  generatedAt: string
  period: { from: string; to: string }
}

/**
 * El dashboard de una comunidad. Cualquier miembro activo (DSH-2); el bloque
 * `finance` es `null` salvo para ADMIN (DSH-3), lo decide la funcion.
 */
export async function getDashboard(
  userId: string,
  communityId: string,
  query: DashboardQueryInput,
): Promise<DashboardView> {
  return ejecuta(() =>
    withContext({ userId, communityId }, async (tx) => {
      const view = await repo.dashboard(tx, communityId, query.from ?? null, query.to ?? null)

      if (!view) {
        throw notFound('Esa comunidad no existe.')
      }

      return view as DashboardView
    }),
  )
}
