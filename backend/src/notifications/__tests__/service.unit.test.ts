// ---------------------------------------------------------------------------
// Servicio de notificaciones (spec 14 §12).
//
// El service es fino: no decide autorizacion (la RLS ya lo hace), solo compone
// la pagina y traduce el marcado vacio a 404. Los unitarios aislan contexto y
// repositorio con mocks y comprueban justo eso: el mapeo a camelCase + ISO, el
// calculo de `offset`/`totalPages` y el 404 cuando el UPDATE afecta 0 filas.
//
// La generacion (los ocho eventos) no se prueba aqui: nace en SQL, y se comprueba
// en la suite de integracion y en `04_verify.sql` (regresion).
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationListRow, NotificationRow } from '../repository.js'
import * as service from '../service.js'

const mocks = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  countUnread: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}))

vi.mock('../../context.js', () => ({
  withContext: async (_ctx: unknown, fn: (tx: unknown) => unknown) => fn({}),
}))

vi.mock('../repository.js', () => ({
  listNotifications: mocks.listNotifications,
  countUnread: mocks.countUnread,
  markRead: mocks.markRead,
  markAllRead: mocks.markAllRead,
}))

function fila(over: Partial<NotificationListRow> = {}): NotificationListRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    type: 'ANNOUNCEMENT_NEW',
    title: 'Nuevo aviso',
    body: 'Se ha publicado un aviso',
    payload: { announcementId: '22222222-2222-2222-2222-222222222222' },
    community_id: '33333333-3333-3333-3333-333333333333',
    read_at: null,
    created_at: new Date('2026-10-15T13:57:16.303Z'),
    total_count: 1n,
    ...over,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('listNotifications', () => {
  it('mapea a camelCase y a ISO, y calcula offset y meta', async () => {
    mocks.listNotifications.mockResolvedValue([
      fila({ total_count: 45n }),
      fila({ id: 'otra', total_count: 45n }),
    ])

    const page = await service.listNotifications('user-1', { unread: false, page: 2, limit: 20 })

    // offset = (page - 1) * limit
    expect(mocks.listNotifications).toHaveBeenCalledWith({}, false, 20, 20)

    expect(page.items[0]).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      type: 'ANNOUNCEMENT_NEW',
      title: 'Nuevo aviso',
      body: 'Se ha publicado un aviso',
      payload: { announcementId: '22222222-2222-2222-2222-222222222222' },
      communityId: '33333333-3333-3333-3333-333333333333',
      readAt: null,
      createdAt: '2026-10-15T13:57:16.303Z',
    })

    expect(page.meta).toEqual({ page: 2, limit: 20, total: 45, totalPages: 3 })
  })

  it('una lista vacia es total 0 y totalPages 0 (no NaN)', async () => {
    mocks.listNotifications.mockResolvedValue([])

    const page = await service.listNotifications('user-1', { unread: true, page: 1, limit: 20 })

    expect(page.items).toEqual([])
    expect(page.meta).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 })
  })

  it('pasa el filtro unread al repositorio', async () => {
    mocks.listNotifications.mockResolvedValue([])

    await service.listNotifications('user-1', { unread: true, page: 1, limit: 20 })

    expect(mocks.listNotifications).toHaveBeenCalledWith({}, true, 20, 0)
  })
})

describe('unreadCount', () => {
  it('devuelve el numero del repositorio', async () => {
    mocks.countUnread.mockResolvedValue(3)

    await expect(service.unreadCount('user-1')).resolves.toBe(3)
  })
})

describe('markRead', () => {
  it('devuelve la notificacion marcada', async () => {
    const leida: NotificationRow = { ...fila(), read_at: new Date('2026-10-15T14:00:00.000Z') }
    mocks.markRead.mockResolvedValue(leida)

    const out = await service.markRead('user-1', '11111111-1111-1111-1111-111111111111')

    expect(mocks.markRead).toHaveBeenCalledWith({}, '11111111-1111-1111-1111-111111111111')
    expect(out.readAt).toBe('2026-10-15T14:00:00.000Z')
  })

  it('sin fila: 404 NOT_FOUND (no existe o no es tuya)', async () => {
    mocks.markRead.mockResolvedValue(null)

    await expect(
      service.markRead('user-1', '11111111-1111-1111-1111-111111111111'),
    ).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    })
  })
})

describe('readAll', () => {
  it('devuelve cuantas cambio el repositorio', async () => {
    mocks.markAllRead.mockResolvedValue(3)

    await expect(service.readAll('user-1')).resolves.toBe(3)
    expect(mocks.markAllRead).toHaveBeenCalledWith({})
  })
})
