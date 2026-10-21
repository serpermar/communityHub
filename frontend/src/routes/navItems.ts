import type { MemberRole } from '@/types/roles'

export interface NavItem {
  segment: string
  labelKey: string
  roles?: MemberRole[]
}

/**
 * Fuente unica de las secciones de una comunidad. La usan el sidebar/breadcrumbs
 * (`AppLayout`) y el selector de comandos (Cmd/Ctrl+K), para que ambos ofrezcan
 * exactamente los mismos destinos con los mismos permisos.
 */
export const NAV_ITEMS: NavItem[] = [
  { segment: 'dashboard', labelKey: 'nav.dashboard' },
  { segment: 'incidents', labelKey: 'nav.incidents' },
  { segment: 'common-areas', labelKey: 'nav.commonAreas' },
  { segment: 'reservations', labelKey: 'nav.reservations' },
  { segment: 'announcements', labelKey: 'nav.announcements' },
  { segment: 'documents', labelKey: 'nav.documents' },
  { segment: 'finance', labelKey: 'nav.finance', roles: ['ADMIN'] },
  { segment: 'votes', labelKey: 'nav.votes', roles: ['ADMIN', 'PRESIDENT', 'NEIGHBOR'] },
  { segment: 'assistant', labelKey: 'nav.assistant' },
  { segment: 'members', labelKey: 'nav.members' },
  { segment: 'settings', labelKey: 'nav.settings', roles: ['ADMIN'] },
]

/** Secciones visibles para un rol (sin rol = publica para cualquier miembro). */
export function visibleNavItems(role: MemberRole | null | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.roles || (role && item.roles.includes(role)))
}
