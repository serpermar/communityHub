import { describe, expect, it } from 'vitest'
import type { Notification } from './types'
import { notificationLink } from './links'

function build(overrides: Partial<Notification>): Notification {
  return {
    id: 'n1',
    type: 'INCIDENT_CREATED',
    title: 'Aviso',
    body: 'Cuerpo',
    payload: {},
    communityId: 'c1',
    readAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('notificationLink', () => {
  it('apunta a la incidencia cuando el payload lleva incidentId', () => {
    expect(notificationLink(build({ payload: { incidentId: 'i1' } }))).toBe('/c/c1/incidents/i1')
  })

  it('apunta a la votación cuando el payload lleva voteId', () => {
    expect(notificationLink(build({ payload: { voteId: 'v1' } }))).toBe('/c/c1/votes/v1')
  })

  it('apunta a avisos cuando el payload lleva announcementId', () => {
    expect(notificationLink(build({ payload: { announcementId: 'a1' } }))).toBe(
      '/c/c1/announcements',
    )
  })

  it('apunta a reservas cuando el payload lleva reservationId', () => {
    expect(notificationLink(build({ payload: { reservationId: 'r1' } }))).toBe('/c/c1/reservations')
  })

  it('prioriza incidentId sobre el resto', () => {
    expect(notificationLink(build({ payload: { incidentId: 'i1', voteId: 'v1' } }))).toBe(
      '/c/c1/incidents/i1',
    )
  })

  it('devuelve null sin comunidad', () => {
    expect(notificationLink(build({ communityId: null, payload: { incidentId: 'i1' } }))).toBeNull()
  })

  it('devuelve null si el payload no tiene destino conocido', () => {
    expect(notificationLink(build({ payload: { otra: 'cosa' } }))).toBeNull()
  })
})
