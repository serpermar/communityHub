import { expect, test } from '@playwright/test'
import { ADMIN, login } from './support/auth'
import { uniqueName } from './support/flows'

// Flujo 2/8: crear incidencia — spec 15-frontend §11.
test('crear incidencia: se registra una incidencia nueva y se ve en su detalle', async ({
  page,
}) => {
  await login(page, ADMIN)

  await page.getByRole('link', { name: 'Incidencias' }).click()
  await expect(page.getByRole('heading', { name: 'Incidencias' })).toBeVisible()

  await page.getByRole('button', { name: 'Nueva incidencia' }).click()
  await expect(page.getByRole('heading', { name: 'Nueva incidencia' })).toBeVisible()

  const title = uniqueName('Fuga de prueba E2E')
  await page.getByLabel(/título/i).fill(title)
  await page.getByLabel(/descripción/i).fill('Creada por la prueba E2E de Playwright.')
  await page.getByRole('button', { name: 'Crear incidencia' }).click()

  await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByText('Abierta')).toBeVisible()
})

// Flujo 3/8: consultar incidencia — spec 15-frontend §11.
test('consultar incidencia: se abre una incidencia sembrada y se ve su detalle', async ({
  page,
}) => {
  await login(page, ADMIN)

  await page.getByRole('link', { name: 'Incidencias' }).click()
  await expect(page.getByRole('heading', { name: 'Incidencias' })).toBeVisible()

  // Incidencia sembrada en la comunidad A (backend/prisma/seed.ts).
  const seededTitle = 'Ascensor parado entre plantas por tercera vez'
  await page.getByRole('button', { name: seededTitle }).click()

  await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { name: seededTitle })).toBeVisible()
  await expect(page.getByText('INC-2026-0002')).toBeVisible()
  await expect(page.getByText('Abierta')).toBeVisible()
})
