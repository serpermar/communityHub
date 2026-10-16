import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'

/**
 * Por defecto no hay sesión: el refresh del arranque devuelve 401. Cada test
 * añade con `server.use(...)` los endpoints que necesite.
 */
export const handlers = [
  http.post('*/api/v1/auth/refresh', () => new HttpResponse(null, { status: 401 })),
]

export const server = setupServer(...handlers)
