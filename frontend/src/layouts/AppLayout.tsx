import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import { LoadingState, ErrorState, Button } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import { CommunityProvider, useCommunity } from '@/context/CommunityContext'
import { useTheme } from '@/context/ThemeContext'
import { NotificationBell } from '@/features/notifications/components/NotificationBell'
import { t } from '@/i18n'
import type { MemberRole } from '@/types/roles'
import { cn } from '@/utils/cn'

interface NavItem {
  segment: string
  labelKey: string
  roles?: MemberRole[]
}

const NAV_ITEMS: NavItem[] = [
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
  const { theme, toggle } = useTheme()
  const [menuOpen, setMenuOpen] = useState(false)

  // El menu movil se cierra al cambiar de seccion.
  useEffect(() => {
    setMenuOpen(false)
  }, [navigate, active?.id])

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

  const navLinks = (
    <nav className="space-y-1" aria-label={t('app.navigation')}>
      {visibleItems.map((item) => (
        <NavLink
          key={item.segment}
          to={`/c/${active!.id}/${item.segment}`}
          onClick={() => setMenuOpen(false)}
          className={({ isActive }) =>
            cn(
              'block rounded-md px-3 py-2 text-sm',
              isActive
                ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
            )
          }
        >
          {t(item.labelKey)}
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          className="rounded-md p-2 text-slate-600 hover:bg-slate-100 md:hidden dark:text-slate-300 dark:hover:bg-slate-800"
          aria-label={menuOpen ? t('app.closeMenu') : t('app.openMenu')}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current">
            <path strokeWidth="1.7" strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>

        <span className="text-sm font-bold tracking-tight text-brand-700 dark:text-brand-400">
          CommunityHub
        </span>

        <label className="sr-only" htmlFor="community-switcher">
          {t('app.switchCommunity')}
        </label>
        <select
          id="community-switcher"
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          value={active?.id ?? ''}
          onChange={(event) => navigate(`/c/${event.target.value}/dashboard`)}
        >
          {!active && <option value="">{t('app.noCommunityOption')}</option>}
          {communities.map((community) => (
            <option key={community.id} value={community.id}>
              {community.name}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {user?.globalRole === 'ADMIN_SA' && (
            <NavLink
              to="/admin/communities/new"
              className="hidden text-sm text-slate-600 hover:text-brand-700 sm:inline dark:text-slate-300 dark:hover:text-brand-400"
            >
              {t('app.newCommunity')}
            </NavLink>
          )}
          <button
            type="button"
            onClick={toggle}
            aria-label={t('app.toggleTheme')}
            className="rounded-md p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-5 w-5 fill-none stroke-current"
            >
              {theme === 'dark' ? (
                <path
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 3v2m0 14v2M5.2 5.2l1.4 1.4m10.8 10.8 1.4 1.4M3 12h2m14 0h2M5.2 18.8l1.4-1.4M17.4 6.6l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"
                />
              ) : (
                <path
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"
                />
              )}
            </svg>
          </button>
          <NotificationBell />
          <NavLink
            to="/account"
            className="hidden text-sm text-slate-600 hover:text-brand-700 sm:inline dark:text-slate-300 dark:hover:text-brand-400"
          >
            {user?.fullName}
          </NavLink>
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            {t('app.logout')}
          </Button>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white p-3 md:block dark:border-slate-800 dark:bg-slate-900">
          {active ? navLinks : <NoCommunity />}
        </aside>

        {active && menuOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div
              className="absolute inset-0 bg-slate-900/40"
              onClick={() => setMenuOpen(false)}
              aria-hidden="true"
            />
            <aside className="relative z-10 h-full w-64 overflow-y-auto border-r border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
              {navLinks}
            </aside>
          </div>
        )}

        <main className="flex-1 bg-slate-50 p-4 md:p-6 dark:bg-slate-950">
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
    <div className="mx-auto max-w-lg rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
        {t('app.noCommunityTitle')}
      </p>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('app.noCommunityBody')}</p>
      <div className="mt-4 flex justify-center gap-2">
        <Button variant="secondary" onClick={() => navigate('/invitations/redeem')}>
          {t('app.redeemInvitation')}
        </Button>
        {user?.globalRole === 'ADMIN_SA' && (
          <Button onClick={() => navigate('/admin/communities/new')}>
            {t('app.createCommunity')}
          </Button>
        )}
      </div>
    </div>
  )
}
