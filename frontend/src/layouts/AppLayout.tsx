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
import { AiFloatingButton } from '@/components/ai/AiFloatingButton'
import { t } from '@/i18n'
import { NAV_ITEMS, visibleNavItems } from '@/routes/navItems'
import { prefetchRoute } from '@/routes/prefetch'
import { cn } from '@/utils/cn'
import styles from './AppLayout.module.css'

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
      <div className={styles.loadingWrap}>
        <LoadingState />
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.errorWrap}>
        <ErrorState error={error} onRetry={reload} />
      </div>
    )
  }

  const visibleItems = visibleNavItems(role)

  const navLinks = (compact: boolean, label: string) => (
    <nav className={styles.nav} aria-label={label}>
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
                styles.navLink,
                styles.navLinkFocus,
                compact && styles.navLinkCompact,
                isActive && styles.navLinkActive,
              )
            }
          >
            {Icon && <Icon aria-hidden="true" />}
            {!compact && <span className={styles.navLabel}>{t(item.labelKey)}</span>}
          </NavLink>
        )
      })}
    </nav>
  )

  return (
    <div className={styles.body} style={{ flexDirection: 'column' }}>
      <a href="#main-content" className={styles.skipLink}>
        {t('app.skipToContent')}
      </a>
      <header aria-label={t('app.header')} className={styles.header}>
        <button
          type="button"
          className={styles.menuButton}
          aria-label={menuOpen ? t('app.closeMenu') : t('app.openMenu')}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.menuIcon}>
            <path strokeWidth="1.7" strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>

        <Logo
          withText
          className="text-brand-700 dark:text-brand-400"
          textClassName={styles.logoText}
        />

        {communities.length > 0 && (
          <CommunitySwitcher communities={communities} activeId={active?.id ?? ''} />
        )}

        <div className={styles.headerActions}>
          {active && (
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label={t('app.commandTrigger')}
              title={t('app.commandTrigger')}
              className={styles.commandButton}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className={styles.commandIcon}>
                <circle cx="11" cy="11" r="7" strokeWidth="1.7" />
                <path strokeWidth="1.7" strokeLinecap="round" d="m20 20-3.5-3.5" />
              </svg>
              <span>{t('app.commandPalette')}</span>
              <kbd className={styles.kbd}>Ctrl K</kbd>
            </button>
          )}
          {user?.globalRole === 'ADMIN_SA' && (
            <NavLink to="/admin/communities/new" className={styles.newCommunity}>
              {t('app.newCommunity')}
            </NavLink>
          )}
          <ThemeToggle />
          <NotificationBell />
          <NavLink to="/account" className={styles.accountLink}>
            {user?.fullName}
          </NavLink>
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            {t('app.logout')}
          </Button>
        </div>
      </header>

      <div className={styles.body}>
        <aside
          aria-label={t('app.mainNavigation')}
          className={cn(
            styles.sidebar,
            collapsed ? styles.sidebarCollapsed : styles.sidebarExpanded,
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
                className={styles.collapseButton}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  className={cn(styles.collapseIcon, collapsed && styles.collapseIconRotated)}
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
          <div className={styles.mobileOverlay}>
            <div
              className={styles.mobileBackdrop}
              onClick={() => setMenuOpen(false)}
              aria-hidden="true"
            />
            <aside aria-label={t('app.mobileNavigation')} className={styles.mobileSidebar}>
              {navLinks(false, t('app.mobileNavigation'))}
            </aside>
          </div>
        )}

        <main id="main-content" className={styles.main}>
          {active ? (
            <>
              <Breadcrumbs pathname={location.pathname} communityId={active.id} />
              <div key={location.pathname} className={styles.contentFade}>
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
      <AiFloatingButton />
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
    <nav aria-label={t('app.breadcrumb')} className={styles.breadcrumbsNav}>
      <ol className={styles.breadcrumbsList}>
        <li>
          <Link to={`${prefix}/dashboard`} className={styles.breadcrumbLink}>
            {t('nav.dashboard')}
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li aria-current="page" className={styles.breadcrumbCurrent}>
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
    <div className={styles.noCommunity}>
      <p className={styles.noCommunityTitle}>{t('app.noCommunityTitle')}</p>
      <p className={styles.noCommunityBody}>{t('app.noCommunityBody')}</p>
      <div className={styles.noCommunityActions}>
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
