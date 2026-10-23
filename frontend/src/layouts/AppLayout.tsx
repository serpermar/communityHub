import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { LoadingState, ErrorState, Button, ThemeToggle } from '@/components/ui'
import { CommandPalette } from '@/components/ui'
import { Logo } from '@/components/brand/Logo'
import { NAV_ICONS } from '@/components/brand/NavIcons'
import { useAuth } from '@/context/AuthContext'
import { CommunityProvider, useCommunity } from '@/context/CommunityContext'
import { NotificationBell } from '@/features/notifications/components/NotificationBell'
import { CommunitySwitcher } from '@/features/communities/components/CommunitySwitcher'
import { t } from '@/i18n'
import { NAV_ITEMS, visibleNavItems } from '@/routes/navItems'
import { prefetchRoute } from '@/routes/prefetch'
import { cn } from '@/utils/cn'

const SIDEBAR_KEY = 'communityhub.sidebar'

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
  const location = useLocation()
  const { user, logout } = useAuth()
  const { active, communities, role, loading, error, reload } = useCommunity()
  const [menuOpen, setMenuOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== 'undefined' && window.localStorage.getItem(SIDEBAR_KEY) === 'collapsed',
  )

  // El menu movil se cierra al cambiar de seccion.
  useEffect(() => {
    setMenuOpen(false)
  }, [navigate, active?.id])

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'expanded')
  }, [collapsed])

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

  const visibleItems = visibleNavItems(role)

  const navLinks = (compact: boolean, label: string) => (
    <nav className="space-y-1" aria-label={label}>
      {visibleItems.map((item) => {
        const Icon = NAV_ICONS[item.segment]
        return (
          <NavLink
            key={item.segment}
            to={`/c/${active!.id}/${item.segment}`}
            onClick={() => setMenuOpen(false)}
            onMouseEnter={() => prefetchRoute(item.segment)}
            onFocus={() => prefetchRoute(item.segment)}
            title={compact ? t(item.labelKey) : undefined}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-control px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900',
                compact && 'justify-center px-2',
                isActive
                  ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
              )
            }
          >
            {Icon && <Icon aria-hidden="true" />}
            {!compact && <span className="truncate">{t(item.labelKey)}</span>}
          </NavLink>
        )
      })}
    </nav>
  )

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        {t('app.skipToContent')}
      </a>
      <header
        aria-label={t('app.header')}
        className="flex items-center gap-3 border-b border-slate-200 bg-surface px-4 py-3 dark:border-slate-800 dark:bg-slate-900"
      >
        <button
          type="button"
          className="rounded-control p-2 text-slate-600 hover:bg-slate-100 md:hidden dark:text-slate-300 dark:hover:bg-slate-800"
          aria-label={menuOpen ? t('app.closeMenu') : t('app.openMenu')}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current">
            <path strokeWidth="1.7" strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>

        <Logo
          withText
          className="text-brand-700 dark:text-brand-400"
          textClassName="hidden text-base sm:inline"
        />

        {communities.length > 0 && (
          <CommunitySwitcher communities={communities} activeId={active?.id ?? ''} />
        )}

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {active && (
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label={t('app.commandTrigger')}
              title={t('app.commandTrigger')}
              className="hidden items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 md:flex dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-4 w-4 fill-none stroke-current"
              >
                <circle cx="11" cy="11" r="7" strokeWidth="1.7" />
                <path strokeWidth="1.7" strokeLinecap="round" d="m20 20-3.5-3.5" />
              </svg>
              <span>{t('app.commandPalette')}</span>
              <kbd className="rounded border border-slate-300 px-1 text-xs dark:border-slate-600">
                Ctrl K
              </kbd>
            </button>
          )}
          {user?.globalRole === 'ADMIN_SA' && (
            <NavLink
              to="/admin/communities/new"
              className="hidden text-sm text-slate-600 hover:text-brand-700 sm:inline dark:text-slate-300 dark:hover:text-brand-400"
            >
              {t('app.newCommunity')}
            </NavLink>
          )}
          <ThemeToggle />
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
        <aside
          aria-label={t('app.mainNavigation')}
          className={cn(
            'hidden shrink-0 border-r border-slate-200 bg-surface p-3 md:block dark:border-slate-800 dark:bg-slate-900',
            collapsed ? 'w-16' : 'w-56',
          )}
        >
          {active ? (
            <>
              {navLinks(collapsed, t('app.mainNavigation'))}
              <button
                type="button"
                onClick={() => setCollapsed((value) => !value)}
                aria-label={collapsed ? t('app.expandSidebar') : t('app.collapseSidebar')}
                aria-pressed={collapsed}
                className="mt-2 flex w-full items-center justify-center rounded-control px-2 py-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className={cn(
                    'h-4 w-4 fill-none stroke-current transition-transform',
                    collapsed && 'rotate-180',
                  )}
                >
                  <path strokeWidth="2" strokeLinecap="round" d="M15 6l-6 6 6 6" />
                </svg>
              </button>
            </>
          ) : (
            <NoCommunity />
          )}
        </aside>

        {active && menuOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div
              className="absolute inset-0 bg-slate-900/40"
              onClick={() => setMenuOpen(false)}
              aria-hidden="true"
            />
            <aside
              aria-label={t('app.mobileNavigation')}
              className="relative z-10 h-full w-64 overflow-y-auto border-r border-slate-200 bg-surface p-3 dark:border-slate-800 dark:bg-slate-900"
            >
              {navLinks(false, t('app.mobileNavigation'))}
            </aside>
          </div>
        )}

        <main id="main-content" className="flex-1 bg-slate-50 p-4 md:p-6 dark:bg-slate-950">
          {active ? (
            <>
              <Breadcrumbs pathname={location.pathname} communityId={active.id} />
              <div key={location.pathname} className="motion-safe:animate-fade-in-up">
                <Outlet />
              </div>
            </>
          ) : (
            <NoCommunity />
          )}
        </main>
      </div>

      {active && (
        <CommandPalette
          communityId={active.id}
          role={role}
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
        />
      )}
    </div>
  )
}

/**
 * Migas de pan del nivel de sección. No intenta reflejar el detalle (el id de
 * un recurso no es un nombre legible): solo dice en qué módulo estás y ofrece
 * volver al panel.
 */
function Breadcrumbs({ pathname, communityId }: { pathname: string; communityId: string }) {
  const prefix = `/c/${communityId}`
  if (!pathname.startsWith(prefix)) return null
  const segment = pathname.slice(prefix.length).split('/').filter(Boolean)[0]
  if (!segment || segment === 'dashboard') return null
  const item = NAV_ITEMS.find((candidate) => candidate.segment === segment)
  if (!item) return null

  return (
    <nav aria-label={t('app.breadcrumb')} className="mb-4">
      <ol className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <li>
          <Link
            to={`${prefix}/dashboard`}
            className="hover:text-brand-700 dark:hover:text-brand-400"
          >
            {t('nav.dashboard')}
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li aria-current="page" className="font-medium text-slate-700 dark:text-slate-200">
          {t(item.labelKey)}
        </li>
      </ol>
    </nav>
  )
}

function NoCommunity() {
  const { user } = useAuth()
  const navigate = useNavigate()
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-dashed border-slate-300 bg-surface p-8 text-center dark:border-slate-700 dark:bg-slate-900">
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
