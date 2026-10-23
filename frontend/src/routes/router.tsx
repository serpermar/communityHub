import { Suspense, lazy } from 'react'
import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom'
import { LoadingState } from '@/components/ui'
import { ScrollToTop } from '@/components/ScrollToTop'
import { AuthLayout } from '@/layouts/AuthLayout'
import { AppLayout } from '@/layouts/AppLayout'
import { ProtectedRoute } from '@/routes/ProtectedRoute'
import { ForbiddenState, GlobalRoleGate, RoleGate } from '@/routes/RoleGate'
import { NotFoundPage } from '@/routes/NotFoundPage'

const LoginPage = lazy(() =>
  import('@/features/auth/pages/LoginPage').then((m) => ({ default: m.LoginPage })),
)
const RegisterPage = lazy(() =>
  import('@/features/auth/pages/RegisterPage').then((m) => ({ default: m.RegisterPage })),
)
const HomeRedirectPage = lazy(() =>
  import('@/features/communities/pages/HomeRedirectPage').then((m) => ({
    default: m.HomeRedirectPage,
  })),
)
const CommunitySettingsPage = lazy(() =>
  import('@/features/communities/pages/CommunitySettingsPage').then((m) => ({
    default: m.CommunitySettingsPage,
  })),
)
const PlatformAdminCreatePage = lazy(() =>
  import('@/features/communities/pages/PlatformAdminCreatePage').then((m) => ({
    default: m.PlatformAdminCreatePage,
  })),
)
const RedeemInvitationPage = lazy(() =>
  import('@/features/members/pages/RedeemInvitationPage').then((m) => ({
    default: m.RedeemInvitationPage,
  })),
)
const MembersPage = lazy(() =>
  import('@/features/members/pages/MembersPage').then((m) => ({ default: m.MembersPage })),
)
const DashboardPage = lazy(() =>
  import('@/features/dashboard/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
)
const IncidentListPage = lazy(() =>
  import('@/features/incidents/pages/IncidentListPage').then((m) => ({
    default: m.IncidentListPage,
  })),
)
const IncidentCreatePage = lazy(() =>
  import('@/features/incidents/pages/IncidentCreatePage').then((m) => ({
    default: m.IncidentCreatePage,
  })),
)
const IncidentDetailPage = lazy(() =>
  import('@/features/incidents/pages/IncidentDetailPage').then((m) => ({
    default: m.IncidentDetailPage,
  })),
)
const CommonAreaListPage = lazy(() =>
  import('@/features/common-areas/pages/CommonAreaListPage').then((m) => ({
    default: m.CommonAreaListPage,
  })),
)
const CommonAreaDetailPage = lazy(() =>
  import('@/features/common-areas/pages/CommonAreaDetailPage').then((m) => ({
    default: m.CommonAreaDetailPage,
  })),
)
const ReservationListPage = lazy(() =>
  import('@/features/reservations/pages/ReservationListPage').then((m) => ({
    default: m.ReservationListPage,
  })),
)
const AnnouncementsPage = lazy(() =>
  import('@/features/announcements/pages/AnnouncementsPage').then((m) => ({
    default: m.AnnouncementsPage,
  })),
)
const DocumentsPage = lazy(() =>
  import('@/features/documents/pages/DocumentsPage').then((m) => ({ default: m.DocumentsPage })),
)
const FinancePage = lazy(() =>
  import('@/features/finance/pages/FinancePage').then((m) => ({ default: m.FinancePage })),
)
const VotingPage = lazy(() =>
  import('@/features/voting/pages/VotingPage').then((m) => ({ default: m.VotingPage })),
)
const VoteCreatePage = lazy(() =>
  import('@/features/voting/pages/VoteCreatePage').then((m) => ({ default: m.VoteCreatePage })),
)
const VoteDetailPage = lazy(() =>
  import('@/features/voting/pages/VoteDetailPage').then((m) => ({ default: m.VoteDetailPage })),
)
const AssistantPage = lazy(() =>
  import('@/features/assistant/pages/AssistantPage').then((m) => ({ default: m.AssistantPage })),
)
const AccountPage = lazy(() =>
  import('@/features/account/pages/AccountPage').then((m) => ({ default: m.AccountPage })),
)
const NotificationsPage = lazy(() =>
  import('@/features/notifications/pages/NotificationsPage').then((m) => ({
    default: m.NotificationsPage,
  })),
)

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <LoadingState />
    </div>
  )
}

export const router = createBrowserRouter([
  {
    element: (
      <Suspense fallback={<RouteFallback />}>
        <ScrollToTop />
        <Outlet />
      </Suspense>
    ),
    children: [
      {
        element: <AuthLayout />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/register', element: <RegisterPage /> },
        ],
      },
      {
        element: <ProtectedRoute />,
        children: [
          { path: '/', element: <HomeRedirectPage /> },
          { path: '/invitations/redeem', element: <RedeemInvitationPage /> },
          { path: '/account', element: <AccountPage /> },
          { path: '/notifications', element: <NotificationsPage /> },
          {
            path: '/admin/communities/new',
            element: (
              <GlobalRoleGate roles={['ADMIN_SA']} fallback={<ForbiddenState />}>
                <PlatformAdminCreatePage />
              </GlobalRoleGate>
            ),
          },
          {
            path: '/c/:communityId',
            element: <AppLayout />,
            children: [
              { index: true, element: <Navigate to="dashboard" replace /> },
              { path: 'dashboard', element: <DashboardPage /> },
              { path: 'incidents', element: <IncidentListPage /> },
              { path: 'incidents/new', element: <IncidentCreatePage /> },
              { path: 'incidents/:incidentId', element: <IncidentDetailPage /> },
              { path: 'common-areas', element: <CommonAreaListPage /> },
              { path: 'common-areas/:areaId', element: <CommonAreaDetailPage /> },
              { path: 'reservations', element: <ReservationListPage /> },
              { path: 'announcements', element: <AnnouncementsPage /> },
              { path: 'documents', element: <DocumentsPage /> },
              {
                path: 'finance',
                element: (
                  <RoleGate roles={['ADMIN']} fallback={<ForbiddenState />}>
                    <FinancePage />
                  </RoleGate>
                ),
              },
              { path: 'votes', element: <VotingPage /> },
              {
                path: 'votes/new',
                element: (
                  <RoleGate roles={['ADMIN', 'PRESIDENT']} fallback={<ForbiddenState />}>
                    <VoteCreatePage />
                  </RoleGate>
                ),
              },
              { path: 'votes/:voteId', element: <VoteDetailPage /> },
              { path: 'assistant', element: <AssistantPage /> },
              { path: 'members', element: <MembersPage /> },
              {
                path: 'settings',
                element: (
                  <RoleGate roles={['ADMIN']} fallback={<ForbiddenState />}>
                    <CommunitySettingsPage />
                  </RoleGate>
                ),
              },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])
