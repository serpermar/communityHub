import { expect, type Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Cuentas sembradas por `backend/prisma/seed.ts`.
//
// La contraseña de todas las cuentas de prueba es la misma (TEST_PASSWORD del
// seed). Se pueden sobrescribir por variables de entorno para apuntar a otro
// entorno:
//
//   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD
//   E2E_PRESIDENT_EMAIL / E2E_PRESIDENT_PASSWORD
//   E2E_NEIGHBOR_EMAIL / E2E_NEIGHBOR_PASSWORD
// ---------------------------------------------------------------------------

export interface TestCredentials {
  email: string
  password: string
}

const DEFAULT_PASSWORD = process.env.E2E_PASSWORD ?? 'CommunityHub2026'

export const ADMIN: TestCredentials = {
  email: process.env.E2E_ADMIN_EMAIL ?? 'ana@comunidad-a.test',
  password: process.env.E2E_ADMIN_PASSWORD ?? DEFAULT_PASSWORD,
}

export const PRESIDENT: TestCredentials = {
  email: process.env.E2E_PRESIDENT_EMAIL ?? 'luis@comunidad-a.test',
  password: process.env.E2E_PRESIDENT_PASSWORD ?? DEFAULT_PASSWORD,
}

export const NEIGHBOR: TestCredentials = {
  email: process.env.E2E_NEIGHBOR_EMAIL ?? 'marta@comunidad-a.test',
  password: process.env.E2E_NEIGHBOR_PASSWORD ?? DEFAULT_PASSWORD,
}

/**
 * Inicia sesión por la UI y espera a que el shell de la app esté listo:
 * URL `/c/<communityId>/dashboard` y la navegación lateral visible.
 */
export async function login(page: Page, credentials: TestCredentials = ADMIN): Promise<void> {
  await page.goto('/login')

  await page.getByLabel(/correo electrónico/i).fill(credentials.email)
  await page.getByLabel(/contraseña/i).fill(credentials.password)
  await page.getByRole('button', { name: 'Entrar' }).click()

  // `/` redirige a la primera comunidad del usuario (HomeRedirectPage).
  await expect(page).toHaveURL(/\/c\/[^/]+\/dashboard/)
  await expect(page.getByRole('link', { name: 'Panel' })).toBeVisible()
}
