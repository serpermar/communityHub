export const MEMBER_ROLES = ['ADMIN', 'PRESIDENT', 'NEIGHBOR', 'PROVIDER'] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]

export const GLOBAL_ROLES = ['NEIGHBOR', 'ADMIN_SA'] as const
export type GlobalRole = (typeof GLOBAL_ROLES)[number]

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  ADMIN: 'Administrador',
  PRESIDENT: 'Presidente',
  NEIGHBOR: 'Vecino',
  PROVIDER: 'Proveedor',
}

export const GLOBAL_ROLE_LABELS: Record<GlobalRole, string> = {
  NEIGHBOR: 'Usuario',
  ADMIN_SA: 'Administrador de plataforma',
}

/** Rangos de gestion: a mayor numero, mas privilegio dentro de la comunidad. */
export const ROLE_RANK: Record<MemberRole, number> = {
  PROVIDER: 0,
  NEIGHBOR: 1,
  PRESIDENT: 2,
  ADMIN: 3,
}

/** Roles que pueden gestionar la comunidad (avisos, miembros, zonas). */
export const MANAGER_ROLES: MemberRole[] = ['ADMIN', 'PRESIDENT']

export function isManager(role: MemberRole | null | undefined): boolean {
  return role === 'ADMIN' || role === 'PRESIDENT'
}

export function isAdmin(role: MemberRole | null | undefined): boolean {
  return role === 'ADMIN'
}
