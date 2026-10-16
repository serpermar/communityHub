# Contribuir · CommunityHub

Guía breve para desarrollar y probar el proyecto. El montaje del backend y de
Supabase está en [`README.md`](./README.md); el frontend es un paquete aparte en
`frontend/`, con su propia spec ([`specs/15-frontend.md`](../specs/15-frontend.md)).

---

## Testing del frontend

La SPA vive en `frontend/` (React 18 + Vite + TypeScript + Tailwind + React
Router). Antes de probarla, arranca el backend y siembra los datos de demo (ver
[`README.md`](./README.md)).

```bash
cd frontend
npm install
```

- **Tipos:** `npm run typecheck` (tsc, sin emitir).
- **Unitarios, componente e integración:** `npm run test` (Vitest + React Testing
  Library + MSW; el backend va mockeado, nunca contra Supabase).
- **Extremo a extremo:** `npm run test:e2e` (Playwright). Necesita el backend
  arrancado y los datos de demo sembrados, porque recorre los 8 flujos reales.
- **Navegadores de Playwright:** `npm run test:e2e:install` instala Chromium la
  primera vez (`playwright install chromium`).
