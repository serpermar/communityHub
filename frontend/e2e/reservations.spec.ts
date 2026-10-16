import { expect, test } from '@playwright/test'
import { ADMIN, login } from './support/auth'
import { createCommonArea, reserveFirstFreeSlot, uniqueName } from './support/flows'

// Flujo 4/8: crear reserva — spec 15-frontend §11.
test('crear reserva: se reserva un hueco libre de una zona y aparece en Reservas', async ({
  page,
}) => {
  await login(page, ADMIN)

  const areaName = uniqueName('Zona E2E reserva')
  await createCommonArea(page, areaName)
  await reserveFirstFreeSlot(page, areaName)

  await expect(page.getByRole('heading', { name: 'Reservas' })).toBeVisible()
  await expect(page.getByRole('cell', { name: areaName })).toBeVisible()
})

// Flujo 5/8: cancelar reserva — spec 15-frontend §11.
test('cancelar reserva: la reserva creada pasa a estado Cancelada', async ({ page }) => {
  await login(page, ADMIN)

  const areaName = uniqueName('Zona E2E cancelar')
  await createCommonArea(page, areaName)
  await reserveFirstFreeSlot(page, areaName)

  await expect(page.getByRole('heading', { name: 'Reservas' })).toBeVisible()
  const row = page.getByRole('row').filter({ hasText: areaName })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'Cancelar' }).click()

  await expect(row.getByText('Cancelada')).toBeVisible()
})
