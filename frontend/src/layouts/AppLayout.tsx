import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom'
import { Button, CommandPalette, ErrorState, ThemeToggle, Tooltip } from '@/components/ui'
import { NotificationBell } from '@/features/notifications/components/NotificationBell'
import { Logo } from '@/components/brand/Logo'
import { NAV_ICONS } from '@/components/brand/NavIcons'
import { CommunitySwitcher } from '@/features/communities/components/CommunitySwitcher'
import { useAuth } from '@/context/AuthContext'
import { useCommunity } from '@/context/CommunityContext'
import { useAppLayout } from '@/hooks/useAppLayout'
import { t } from '@/i18n'
import { visibleNavItems } from '@/routes/navItems'
import { prefetchRoute } from '@/routes/prefetch'
import { cn } from '@/utils/cn'
import { AiFloatingButton } from '@/components/ai/AiFloatingButton'
import { CommunityProvider } from '@/context/CommunityContext'
import styles from './AppLayout.module.css'

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      className={className}
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  const path = direction === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={styles.collapseIcon}
    >
      <path d={path} />
    </svg>
  )
}

function LayoutSkeleton() {
  return (
    <div className={styles.layoutSkeleton} aria-hidden="true">
      <div className={styles.skeletonHeader} />
      <div className={styles.skeletonBody}>
        <div className={styles.skeletonSidebar} />
        <div className={styles.skeletonMain}>
          <div className={styles.skeletonTitle} />
          <div className={styles.skeletonGrid}>
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className={styles.skeletonCard} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function AppLayoutInner() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const { active, communities, role, loading, error, reload } = useCommunity()

  const {
    collapsed,
    menuOpen,
    paletteOpen,
    desktopSidebarRef,
    mobileSidebarRef,
    mobileTriggerRef,
    setPaletteOpen,
    setMenuOpen,
    toggleCollapsed,
    openMenu,
    closeMenu,
  } = useAppLayout({ activeId: active?.id })

  // El atajo Ctrl/Cmd+K lo maneja CommandPalette internamente, pero además
  // abrimos el palette desde el botón. Ya está montado, así que solo pasamos
  // open/onOpenChange.

  if (loading && !active) return <LayoutSkeleton />
  if (error) return <ErrorState error={error} onRetry={reload} />

  if (!active) {
    return (
      <div className={styles.noCommunity}>
        <div className={styles.noCommunityIcon} aria-hidden="true">
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 40V20l16-12 16 12v20" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M18 40V28h12v12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p className={styles.noCommunityTitle}>{t('app.noCommunityTitle')}</p>
        <p className={styles.noCommunityBody}>{t('app.noCommunityBody')}</p>
        <div className={styles.noCommunityActions}>
          <Button onClick={() => navigate('/invitations/redeem')}>
            {t('app.redeemInvitation')}
          </Button>
          {user?.globalRole === 'ADMIN_SA' && (
            <Button variant="secondary" onClick={() => navigate('/admin/communities/new')}>
              {t('app.createCommunity')}
            </Button>
          )}
        </div>
        <Link to="/invitations" className={styles.noCommunityLink}>
          {t('app.viewInvitations')}
        </Link>
      </div>
    )
  }

  const visibleItems = visibleNavItems(role)

  const renderNavLinks = (compact: boolean, label: string) => (
    <nav className={styles.nav} aria-label={label}>
      {visibleItems.map((item) => {
        const Icon = NAV_ICONS[item.segment]
        const labelText = t(item.labelKey)
        const link = (
          <NavLink
            key={item.segment}
            to={`/c/${active.id}/${item.segment}`}
            onClick={() => setMenuOpen(false)}
            onMouseEnter={() => prefetchRoute(item.segment)}
            onFocus={() => prefetchRoute(item.segment)}
            className={({ isActive }) =>
              cn(
                styles.navLink,
                styles.navLinkFocus,
                compact && styles.navLinkCompact,
                isActive && styles.navLinkActive,
              )
            }
            aria-label={compact ? labelText : undefined}
          >
            {Icon && <Icon aria-hidden="true" />}
            {!compact && <span className={styles.navLabel}>{labelText}</span>}
          </NavLink>
        )
        if (compact) {
          return (
            <Tooltip key={item.segment} label={labelText}>
              {link}
            </Tooltip>
          )
        }
        return link
      })}
    </nav>
  )

  return (
    <>
      <a href="#main-content" className={styles.skipLink}>
        {t('app.skipToContent')}
      </a>

      <div className={styles.layout}>
        {/* Sidebar de escritorio */}
        <aside
          ref={desktopSidebarRef}
          className={cn(
            styles.sidebar,
            collapsed ? styles.sidebarCollapsed : styles.sidebarExpanded,
          )}
          aria-label={t('app.mainNavigation')}
        >
          <div className={styles.sidebarBrand}>
            <Logo withText={!collapsed} />
          </div>

          {renderNavLinks(collapsed, t('app.mainNavigation'))}

          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? t('app.expandSidebar') : t('app.collapseSidebar')}
            aria-pressed={collapsed}
            className={styles.collapseButton}
          >
            <ChevronIcon direction={collapsed ? 'right' : 'left'} />
          </button>
        </aside>

        {/* Contenido principal */}
        <div className={styles.body}>
          <header className={styles.header}>
            <button
              ref={mobileTriggerRef}
              type="button"
              onClick={openMenu}
              aria-label={t('app.openMenu')}
              aria-expanded={menuOpen}
              aria-controls="mobile-sidebar"
              className={styles.menuButton}
            >
              <MenuIcon className={styles.menuIcon} />
            </button>

            <div className={styles.headerActions}>
              <div className={styles.headerGroup}>
                {communities.length > 0 && (
                  <CommunitySwitcher communities={communities} activeId={active.id} />
                )}
                <button
                  type="button"
                  onClick={() => setPaletteOpen(true)}
                  aria-label={t('app.commandTrigger')}
                  className={styles.commandButton}
                >
                  <SearchIcon className={styles.commandIcon} />
                  <span className={styles.commandLabel}>{t('app.commandPalette')}</span>
                  <kbd className={styles.kbd}>Ctrl K</kbd>
                </button>
                <button
                  type="button"
                  onClick={() => setPaletteOpen(true)}
                  aria-label={t('app.commandTrigger')}
                  className={styles.commandButtonCompact}
                >
                  <SearchIcon className={styles.commandIcon} />
                </button>
                {user?.globalRole === 'ADMIN_SA' && (
                  <Link to="/admin/communities/new" className={styles.newCommunity}>
                    {t('app.newCommunity')}
                  </Link>
                )}
              </div>

              <div className={styles.headerGroup}>
                <ThemeToggle />
                <NotificationBell />
                <Link to="/account" className={styles.accountLink}>
                  {user?.fullName ?? user?.email ?? ''}
                </Link>
                <Button variant="ghost" size="sm" onClick={() => void logout()}>
                  {t('app.logout')}
                </Button>
              </div>
            </div>
          </header>

          <main id="main-content" className={styles.main}>
            <Outlet />
          </main>
        </div>
      </div>

      {/* Sidebar móvil */}
      {menuOpen && (
        <div className={styles.mobileOverlay} role="dialog" aria-modal="true">
          <div className={styles.mobileBackdrop} onClick={closeMenu} aria-hidden="true" />
          <aside
            ref={mobileSidebarRef}
            id="mobile-sidebar"
            className={styles.mobileSidebar}
            aria-label={t('app.mobileNavigation')}
          >
            <div className={styles.mobileHeader}>
              <Logo withText />
              <button
                type="button"
                onClick={closeMenu}
                aria-label={t('app.closeMenu')}
                className={styles.mobileCloseButton}
              >
                ✕
              </button>
            </div>
            {renderNavLinks(false, t('app.mobileNavigation'))}
          </aside>
        </div>
      )}

      {/* Command Palette global */}
      {active && (
        <CommandPalette
          communityId={active.id}
          role={role}
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
        />
      )}

      {/* FAB del asistente */}
      <AiFloatingButton />
    </>
  )
}

export function AppLayout() {
  const { communityId } = useParams<{ communityId: string }>()
  return (
    <CommunityProvider communityId={communityId}>
      <AppLayoutInner />
    </CommunityProvider>
  )
}
