import { defineConfig, devices } from '@playwright/test'

// ---------------------------------------------------------------------------
// Configuración E2E (Playwright) del SPA · spec 15-frontend §11.
//
// IMPORTANTE: el `webServer` de aquí solo levanta el frontend (Vite en el 5173).
// Estas pruebas corren contra el BACKEND REAL, sin mocks de red. El proxy de
// Vite reenvía `/api` a http://localhost:3000 (ver vite.config.ts), así que el
// backend debe estar YA en marcha con la base de datos sembrada:
//
//   backend:  npm run dev        (en backend/, escuchando en :3000)
//   datos:    npm run db:seed    (crea las cuentas y datos de prueba)
//
// Los flujos crean datos reales; se usan valores únicos por ejecución para que
// puedan repetirse sin chocar, pero la base no se limpia entre pruebas.
// ---------------------------------------------------------------------------

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    // `npm run dev` en frontend/ (Vite). El backend (:3000) NO lo levanta esto.
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
