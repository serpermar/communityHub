import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import { LoadingState, ErrorState, Button } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import { CommunityProvider, useCommunity } from '@/context/CommunityContext'
import { NotificationBell } from '@/features/notifications/components/NotificationBell'
import type { MemberRole } from '@/types/roles'
import { cn } from '@/utils/cn'

interface NavItem {
  segment: string
  label: string
  roles?: MemberRole[]
}

const NAV_ITEMS: NavItem[] = [
  { segment: 'dashboard', label: 'Panel' },
  { segment: 'incidents', label: 'Incidencias' },
  { segment: 'common-areas', label: 'Zonas comunes' },
  { segment: 'reservations', label: 'Reservas' },
  { segment: 'announcements', label: 'Avisos' },
  { segment: 'documents', label: 'Documentos' },
  { segment: 'finance', label: 'Finanzas', roles: ['ADMIN'] },
  { segment: 'votes', label: 'Votaciones', roles: ['ADMIN', 'PRESIDENT', 'NEIGHBOR'] },
  { segment: 'assistant', label: 'Asistente IA' },
  { segment: 'members', label: 'Miembros' },
  { segment: 'settings', label: 'Ajustes', roles: ['ADMIN'] },
]

export function AppLayout() {
  const { communityId } = useParams<{ communityId: string }>()
  return (
    <CommunityProvider communityId={communityId}>
      <AppLayoutInner />
    </CommunityProvider>
  )
}

function AppLayoutInner() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const { active, communities, role, loading, error, reload } = useCommunity()

  if (loading && !active) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingState />
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <ErrorState error={error} onRetry={reload} />
      </div>
    )
  }

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.roles || (role && item.roles.includes(role)),
  )

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-3">
        <span className="text-sm font-bold tracking-tight text-brand-700">CommunityHub</span>

        <label className="sr-only" htmlFor="community-switcher">
          Comunidad
        </label>
        <select
          id="community-switcher"
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
          value={active?.id ?? ''}
          onChange={(event) => navigate(`/c/${event.target.value}/dashboard`)}
        >
          {!active && <option value="">Sin comunidad</option>}
          {communities.map((community) => (
            <option key={community.id} value={community.id}>
              {community.name}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-3">
          {user?.globalRole === 'ADMIN_SA' && (
            <NavLink
              to="/admin/communities/new"
              className="text-sm text-slate-600 hover:text-brand-700"
            >
              Nueva comunidad
            </NavLink>
          )}
          <NotificationBell />
          <NavLink
            to="/account"
            className="hidden text-sm text-slate-600 hover:text-brand-700 sm:inline"
          >
            {user?.fullName}
          </NavLink>
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            Salir
          </Button>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white p-3 md:block">
          {active ? (
            <nav className="space-y-1">
              {visibleItems.map((item) => (
                <NavLink
                  key={item.segment}
                  to={`/c/${active.id}/${item.segment}`}
                  className={({ isActive }) =>
                    cn(
                      'block rounded-md px-3 py-2 text-sm',
                      isActive
                        ? 'bg-brand-50 font-medium text-brand-700'
                        : 'text-slate-600 hover:bg-slate-100',
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          ) : (
            <p className="px-3 py-2 text-sm text-slate-500">No perteneces a ninguna comunidad.</p>
          )}
        </aside>

        <main className="flex-1 bg-slate-50 p-4 md:p-6">
          {active ? <Outlet /> : <NoCommunity />}
        </main>
      </div>
    </div>
  )
}

function NoCommunity() {
  const { user } = useAuth()
  const navigate = useNavigate()
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="text-sm font-medium text-slate-700">Aún no tienes ninguna comunidad</p>
      <p className="mt-1 text-sm text-slate-500">
        Entra con una invitación o crea una comunidad si eres administrador de plataforma.
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <Button variant="secondary" onClick={() => navigate('/invitations/redeem')}>
          Canjear invitación
        </Button>
        {user?.globalRole === 'ADMIN_SA' && (
          <Button onClick={() => navigate('/admin/communities/new')}>Crear comunidad</Button>
        )}
      </div>
    </div>
  )
}
