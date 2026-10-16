import { api, cleanParams } from '@/services/http'
import type { ListResult } from '@/types/api'
import type { Reservation, ReservationStatus } from './types'

export interface ReservationListQuery {
  commonAreaId?: string
  date?: string
  status?: ReservationStatus
  page?: number
  limit?: number
}

export function listReservations(
  communityId: string,
  query: ReservationListQuery,
): Promise<ListResult<Reservation>> {
  return api.list<Reservation>(`/communities/${communityId}/reservations`, {
    params: cleanParams({ ...query }),
  })
}

export function getReservation(reservationId: string): Promise<Reservation> {
  return api.get<Reservation>(`/reservations/${reservationId}`)
}

export interface CreateReservationInput {
  startsAt: string
  endsAt: string
  attendees?: number
  notes?: string
}

export function createReservation(
  commonAreaId: string,
  input: CreateReservationInput,
): Promise<Reservation> {
  return api.post<Reservation>(`/common-areas/${commonAreaId}/reservations`, input)
}

export function confirmReservation(reservationId: string): Promise<Reservation> {
  return api.post<Reservation>(`/reservations/${reservationId}/confirm`)
}

export function cancelReservation(reservationId: string): Promise<Reservation> {
  return api.patch<Reservation>(`/reservations/${reservationId}/cancel`, {})
}

export function listMyReservations(query: {
  status?: ReservationStatus
  page?: number
  limit?: number
}): Promise<ListResult<Reservation>> {
  return api.list<Reservation>('/reservations/me', { params: cleanParams({ ...query }) })
}
