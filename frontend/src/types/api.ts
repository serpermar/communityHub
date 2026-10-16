export interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface ApiEnvelope<T, M = unknown> {
  data: T
  meta?: M
}

export interface ListResult<T, M = PaginationMeta> {
  data: T[]
  meta: M
}

export interface PageQuery {
  page?: number
  limit?: number
}
