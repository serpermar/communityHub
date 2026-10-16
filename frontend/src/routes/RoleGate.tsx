import type { ReactNode } from 'react'
import { useAuth } from '@/context/AuthContext'
import { useCommunity } from '@/context/CommunityContext'
import type { GlobalRole, MemberRole } from '@/types/roles'
import { ErrorState } from '@/components/ui'
import { ApiError } from '@/services/ApiError'

/**
 * Oculta UI por rol de comunidad (cosmetico). Nunca autoriza: el backend es el
 * unico gatekeeper (FE-1).
 */
export function RoleGate({
  roles,
  children,
  fallback = null,
}: {
  roles: MemberRole[]
  children: ReactNode
  fallback?: ReactNode
}) {
  const { role } = useCommunity()
  if (!role || !roles.includes(role)) return <>{fallback}</>
  return <>{children}</>
}

export function GlobalRoleGate({
  roles,
  children,
  fallback = null,
}: {
  roles: GlobalRole[]
  children: ReactNode
  fallback?: ReactNode
}) {
  const { user } = useAuth()
  if (!user || !roles.includes(user.globalRole)) return <>{fallback}</>
  return <>{children}</>
}

export function ForbiddenState({ message }: { message?: string }) {
  return (
    <ErrorState
      error={
        new ApiError(403, {
          code: 'FORBIDDEN',
          message: message ?? 'No tienes permiso para ver esta sección.',
        })
      }
    />
  )
}
