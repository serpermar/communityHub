import { expect, test } from '@playwright/test'
import { ADMIN, login } from './support/auth'

// Flujo 1/8: login — spec 15-frontend §11.
test('login: un usuario de prueba entra y ve el shell de su comunidad', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible()

  await login(page, ADMIN)

  // Se muestra el conmutador de comunidad y el usuario ha cargado su sesión.
  await expect(page.getByLabel('Comunidad')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Salir' })).toBeVisible()
})
