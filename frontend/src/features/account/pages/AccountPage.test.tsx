import { HttpResponse, http } from 'msw'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/context/AuthContext'
import { ToastProvider } from '@/components/ui'
import { server } from '@/test/server'
import type { AuthUser } from '@/types/auth'
import { AccountPage } from './AccountPage'

const baseUser: AuthUser = {
  id: 'u1',
  email: 'ana@example.com',
  fullName: 'Ana',
  phone: '+34600000000',
  avatarUrl: null,
  globalRole: 'NEIGHBOR',
  emailVerifiedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
}

function renderPage() {
  return render(
    <AuthProvider>
      <ToastProvider>
        <MemoryRouter>
          <AccountPage />
        </MemoryRouter>
      </ToastProvider>
    </AuthProvider>,
  )
}

function authenticatedHandlers() {
  server.use(
    http.post('*/api/v1/auth/refresh', () =>
      HttpResponse.json({ data: { accessToken: 'session-token' } }),
    ),
    http.get('*/api/v1/auth/me', () => HttpResponse.json({ data: baseUser })),
    http.get('*/api/v1/auth/sessions', () => HttpResponse.json({ data: [] })),
  )
}

describe('AccountPage', () => {
  it('precarga el perfil y lo guarda', async () => {
    const patch = vi.fn()
    authenticatedHandlers()
    server.use(
      http.patch('*/api/v1/auth/me', async ({ request }) => {
        const body = (await request.json()) as { fullName: string; phone?: string }
        patch(body)
        return HttpResponse.json({ data: { ...baseUser, ...body } })
      }),
    )

    renderPage()

    const name = await screen.findByLabelText(/^nombre/i)
    await waitFor(() => expect(name).toHaveValue('Ana'))

    await userEvent.clear(name)
    await userEvent.type(name, 'Ana María')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith({ fullName: 'Ana María', phone: '+34600000000' }),
    )
    expect(await screen.findByText('Perfil actualizado.')).toBeInTheDocument()
  })

  it('valida en cliente que las contraseñas coinciden', async () => {
    authenticatedHandlers()
    const post = vi.fn()
    server.use(
      http.post('*/api/v1/auth/change-password', () => {
        post()
        return new HttpResponse(null, { status: 204 })
      }),
    )

    renderPage()

    await userEvent.type(await screen.findByLabelText(/contraseña actual/i), 'la-de-antes')
    await userEvent.type(screen.getByLabelText(/^nueva contraseña/i), 'una-nueva-larga-12')
    await userEvent.type(screen.getByLabelText(/^repite la nueva contraseña/i), 'otra-distinta-12')
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }))

    expect(await screen.findByText('Las contraseñas no coinciden.')).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  it('muestra el error de contraseña actual incorrecta en su campo', async () => {
    authenticatedHandlers()
    server.use(
      http.post('*/api/v1/auth/change-password', () =>
        HttpResponse.json(
          {
            error: {
              code: 'CURRENT_PASSWORD_INVALID',
              message: 'La contraseña actual no es correcta.',
            },
          },
          { status: 400 },
        ),
      ),
    )

    renderPage()

    await userEvent.type(await screen.findByLabelText(/contraseña actual/i), 'incorrecta')
    await userEvent.type(screen.getByLabelText(/^nueva contraseña/i), 'una-nueva-larga-12')
    await userEvent.type(
      screen.getByLabelText(/^repite la nueva contraseña/i),
      'una-nueva-larga-12',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }))

    expect(await screen.findByText('La contraseña actual no es correcta.')).toBeInTheDocument()
  })
})
