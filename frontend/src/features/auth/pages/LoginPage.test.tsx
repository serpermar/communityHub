import { HttpResponse, http } from 'msw'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AuthProvider } from '@/context/AuthContext'
import { server } from '@/test/server'
import { LoginPage } from './LoginPage'

function renderLogin() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>Panel de inicio</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

const submit = () => screen.getByRole('button', { name: 'Entrar' })

describe('LoginPage', () => {
  it('valida el formulario vacío', async () => {
    renderLogin()
    await userEvent.click(submit())
    expect(await screen.findByText('El correo es obligatorio.')).toBeInTheDocument()
    expect(screen.getByText('La contraseña es obligatoria.')).toBeInTheDocument()
  })

  it('inicia sesión y navega al inicio', async () => {
    server.use(
      http.post('*/api/v1/auth/login', () =>
        HttpResponse.json({
          data: {
            accessToken: 'access-token',
            user: {
              id: 'u1',
              email: 'ana@example.com',
              fullName: 'Ana',
              phone: null,
              avatarUrl: null,
              globalRole: 'NEIGHBOR',
              emailVerifiedAt: null,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          },
        }),
      ),
    )

    renderLogin()
    await userEvent.type(screen.getByLabelText(/correo electrónico/i), 'ana@example.com')
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'contrasena-larga')
    await userEvent.click(submit())

    expect(await screen.findByText('Panel de inicio')).toBeInTheDocument()
  })

  it('muestra el error del servidor cuando las credenciales fallan', async () => {
    server.use(
      http.post('*/api/v1/auth/login', () =>
        HttpResponse.json(
          { error: { code: 'INVALID_CREDENTIALS', message: 'Credenciales incorrectas.' } },
          { status: 401 },
        ),
      ),
    )

    renderLogin()
    await userEvent.type(screen.getByLabelText(/correo electrónico/i), 'ana@example.com')
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'mala')
    await userEvent.click(submit())

    expect(await screen.findByText('Credenciales incorrectas.')).toBeInTheDocument()
  })
})
