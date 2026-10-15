// ---------------------------------------------------------------------------
// Servicio del dashboard (spec 13 §11).
//
// El service es fino a proposito: la funcion de SQL devuelve el contrato entero
// y aqui solo se abre el contexto de RLS, se comprueba que hay fila y se
// devuelve. Los unitarios aislan las dos dependencias (contexto y repositorio)
// con mocks y comprueban justo eso: que la vista pasa intacta, que `from`/`to`
// llegan como `null` cuando no vienen, y que una fila ausente es un 404.
//
// El contenido real del JSON (recuentos, series, finance por rol) se prueba en
// la suite de integracion, que es donde tiene sentido: depende del motor.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardView } from '../service.js'
import * as service from '../service.js'

const mocks = vi.hoisted(() => ({
  dashboard: vi.fn(),
}))

vi.mock('../../context.js', () => ({
  withContext: async (_ctx: unknown, fn: (tx: unknown) => unknown) => fn({}),
}))

vi.mock('../repository.js', () => ({
  dashboard: mocks.dashboard,
}))

const VIEW: DashboardView = {
  community: { id: 'c1', name: 'Comunidad', city: 'Zaragoza', neighborCount: 4, memberCount: 5 },
  incidents: { open: 2, inProgress: 1, pending: 1, critical: 0, byStatus: [], byCategory: [] },
  reservations: { upcomingCount: 0, upcoming: [], byMonth: [] },
  announcements: { latest: [] },
  votes: { openCount: 0, open: [] },
  finance: null,
  generatedAt: '2026-04-13T10:00:00.000Z',
  period: { from: '2025-05-01', to: '2026-04-13' },
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.dashboard.mockResolvedValue(VIEW)
})

describe('getDashboard', () => {
  it('devuelve la vista que da el repositorio, sin tocarla', async () => {
    const out = await service.getDashboard('user-1', 'community-1', {})

    expect(out).toBe(VIEW)
  })

  it('pasa from y to como null cuando no vienen', async () => {
    await service.getDashboard('user-1', 'community-1', {})

    expect(mocks.dashboard).toHaveBeenCalledWith({}, 'community-1', null, null)
  })

  it('pasa la ventana al repositorio cuando viene', async () => {
    await service.getDashboard('user-1', 'community-1', { from: '2026-01-01', to: '2026-03-01' })

    expect(mocks.dashboard).toHaveBeenCalledWith({}, 'community-1', '2026-01-01', '2026-03-01')
  })

  it('sin fila: 404 NOT_FOUND (defensivo)', async () => {
    mocks.dashboard.mockResolvedValue(null)

    await expect(service.getDashboard('user-1', 'community-1', {})).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    })
  })
})
