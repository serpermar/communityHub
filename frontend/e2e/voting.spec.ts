import { expect, test } from '@playwright/test'
import { ADMIN, login } from './support/auth'
import { createVote, uniqueName } from './support/flows'

// Flujo 6/8: crear votación — spec 15-frontend §11.
test('crear votación: se crea una votación y queda visible en su detalle', async ({ page }) => {
  await login(page, ADMIN)

  const title = uniqueName('Votación E2E')
  const question = '¿Apruebas la propuesta de la prueba automática?'
  await createVote(page, {
    title,
    question,
    optionA: `Sí ${Date.now()}`,
    optionB: `No ${Date.now()}`,
  })

  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByText(question)).toBeVisible()
})

// Flujo 7/8: votar — spec 15-frontend §11.
test('votar: tras publicar la votación, el usuario emite su voto', async ({ page }) => {
  await login(page, ADMIN)

  const title = uniqueName('Votación E2E voto')
  const optionA = `A favor ${Date.now()}`
  await createVote(page, {
    title,
    question: '¿Apruebas la propuesta?',
    optionA,
    optionB: `En contra ${Date.now()}`,
  })

  // La votación nace en borrador: hay que publicarla para poder votar.
  await page.getByRole('button', { name: 'Publicar' }).click()

  await expect(page.getByRole('button', { name: 'Votar' })).toBeVisible()
  await page.getByRole('radio', { name: optionA }).click()
  await page.getByRole('button', { name: 'Votar' }).click()

  await expect(page.getByRole('button', { name: 'Cambiar voto' })).toBeVisible()
  await expect(page.getByText('Tu voto')).toBeVisible()
})

// Flujo 8/8: consultar resultados — spec 15-frontend §11.
test('consultar resultados: se ven las opciones y la participación de una votación cerrada', async ({
  page,
}) => {
  await login(page, ADMIN)

  await page.getByRole('link', { name: 'Votaciones' }).click()
  await expect(page.getByRole('heading', { name: 'Votaciones' })).toBeVisible()

  // Votación sembrada CERRADA en la comunidad A (backend/prisma/seed.ts).
  const seededTitle = '¿Permitir obras los sábados?'
  await page.getByRole('link', { name: seededTitle }).click()

  await expect(page.getByRole('heading', { name: seededTitle })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Resultados' })).toBeVisible()
  await expect(page.getByText(/participación:/i)).toBeVisible()
})
