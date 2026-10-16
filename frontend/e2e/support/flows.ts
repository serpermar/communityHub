import { expect, type Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Helpers compartidos por los flujos que crean datos (zonas, reservas y
// votaciones). Se usan nombres/etiquetas con marca temporal para que cada
// ejecución cree registros distintos sobre la misma base sembrada.
// ---------------------------------------------------------------------------

let sequence = 0

/** Identificador único por ejecución (combina reloj y contador del worker). */
export function uniqueName(prefix: string): string {
  sequence += 1
  return `${prefix} ${Date.now()}-${sequence}`
}

/** Abre una sección del menú lateral de la comunidad activa. */
export async function openNav(page: Page, label: string): Promise<void> {
  await page.getByRole('link', { name: label }).click()
}

/**
 * Crea una zona común nueva (rol ADMIN) desde la pantalla "Zonas comunes"
 * y espera a que aparezca en el listado.
 */
export async function createCommonArea(page: Page, name: string): Promise<void> {
  await openNav(page, 'Zonas comunes')
  await expect(page.getByRole('heading', { name: 'Zonas comunes' })).toBeVisible()

  await page.getByRole('button', { name: 'Nueva zona' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nueva zona común' })
  await expect(dialog).toBeVisible()

  await dialog.getByLabel(/nombre/i).fill(name)
  await dialog.getByRole('button', { name: 'Crear' }).click()

  await expect(page.getByRole('link', { name })).toBeVisible()
}

/**
 * Entra en la zona indicada, elige el primer hueco libre de un día futuro y
 * confirma la reserva. Deja la app en la pantalla de Reservas.
 */
export async function reserveFirstFreeSlot(page: Page, areaName: string, daysAhead = 3): Promise<void> {
  await page.getByRole('link', { name: areaName }).click()
  await expect(page.getByRole('heading', { name: areaName })).toBeVisible()

  const date = new Date()
  date.setDate(date.getDate() + daysAhead)
  await page.getByLabel(/día/i).fill(date.toISOString().slice(0, 10))

  const slot = page.getByRole('button', { name: /^\d{2}:\d{2}$/ }).first()
  await expect(slot).toBeVisible()
  await slot.click()

  await expect(page.getByText('Reservar franja')).toBeVisible()
  await page.getByRole('button', { name: 'Reservar' }).click()

  await expect(page).toHaveURL(/\/reservations$/)
}

/**
 * Crea una votación (rol ADMIN/PRESIDENT) y espera a aterrizar en su detalle.
 * Las fechas usan los valores por defecto del formulario (ahora → +7 días).
 */
export async function createVote(
  page: Page,
  data: { title: string; question: string; optionA: string; optionB: string },
): Promise<void> {
  await openNav(page, 'Votaciones')
  await expect(page.getByRole('heading', { name: 'Votaciones' })).toBeVisible()

  await page.getByRole('button', { name: 'Nueva votación' }).click()
  await page.getByLabel(/título/i).fill(data.title)
  await page.getByLabel(/pregunta/i).fill(data.question)
  await page.getByLabel('Opción 1').fill(data.optionA)
  await page.getByLabel('Opción 2').fill(data.optionB)
  await page.getByRole('button', { name: 'Crear votación' }).click()

  await expect(page.getByRole('heading', { name: data.title })).toBeVisible()
}
