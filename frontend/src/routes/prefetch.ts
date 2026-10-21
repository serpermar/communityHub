/**
 * Precarga por segmento de seccion (FE-27).
 *
 * Al pasar el raton o enfocar un enlace del sidebar o del selector de comandos,
 * se dispara el `import()` del chunk de esa pagina. El `Suspense` del router ya
 * la resolvera al navegar: esto no cambia el comportamiento, solo adelanta la
 * descarga y evita el parpadeo del fallback. Es idempotente (Vite cachea el
 * modulo tras el primer import).
 *
 * Vive aparte de `router.tsx` para que `AppLayout` pueda importarlo sin crear un
 * ciclo de imports (router -> AppLayout -> router).
 */
const PREFETCH: Record<string, () => Promise<unknown>> = {
  dashboard: () => import('@/features/dashboard/pages/DashboardPage'),
  incidents: () => import('@/features/incidents/pages/IncidentListPage'),
  'common-areas': () => import('@/features/common-areas/pages/CommonAreaListPage'),
  reservations: () => import('@/features/reservations/pages/ReservationListPage'),
  announcements: () => import('@/features/announcements/pages/AnnouncementsPage'),
  documents: () => import('@/features/documents/pages/DocumentsPage'),
  finance: () => import('@/features/finance/pages/FinancePage'),
  votes: () => import('@/features/voting/pages/VotingPage'),
  assistant: () => import('@/features/assistant/pages/AssistantPage'),
  members: () => import('@/features/members/pages/MembersPage'),
  settings: () => import('@/features/communities/pages/CommunitySettingsPage'),
}

/** Dispara la descarga anticipada del chunk de una seccion (si existe). */
export function prefetchRoute(segment: string) {
  void PREFETCH[segment]?.()
}
