import { Navigate, createBrowserRouter } from 'react-router-dom'
import { AuthLayout } from '@/layouts/AuthLayout'
import { AppLayout } from '@/layouts/AppLayout'
import { ProtectedRoute } from '@/routes/ProtectedRoute'
import { ForbiddenState, GlobalRoleGate, RoleGate } from '@/routes/RoleGate'
import { NotFoundPage } from '@/routes/NotFoundPage'
import { LoginPage } from '@/features/auth/pages/LoginPage'
import { RegisterPage } from '@/features/auth/pages/RegisterPage'
import { HomeRedirectPage } from '@/features/communities/pages/HomeRedirectPage'
import { CommunitySettingsPage } from '@/features/communities/pages/CommunitySettingsPage'
import { PlatformAdminCreatePage } from '@/features/communities/pages/PlatformAdminCreatePage'
import { RedeemInvitationPage } from '@/features/members/pages/RedeemInvitationPage'
import { MembersPage } from '@/features/members/pages/MembersPage'
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage'
import { IncidentListPage } from '@/features/incidents/pages/IncidentListPage'
import { IncidentCreatePage } from '@/features/incidents/pages/IncidentCreatePage'
import { IncidentDetailPage } from '@/features/incidents/pages/IncidentDetailPage'
import { CommonAreaListPage } from '@/features/common-areas/pages/CommonAreaListPage'
import { CommonAreaDetailPage } from '@/features/common-areas/pages/CommonAreaDetailPage'
import { ReservationListPage } from '@/features/reservations/pages/ReservationListPage'
import { AnnouncementsPage } from '@/features/announcements/pages/AnnouncementsPage'
import { DocumentsPage } from '@/features/documents/pages/DocumentsPage'
import { FinancePage } from '@/features/finance/pages/FinancePage'
import { VotingPage } from '@/features/voting/pages/VotingPage'
import { VoteCreatePage } from '@/features/voting/pages/VoteCreatePage'
import { VoteDetailPage } from '@/features/voting/pages/VoteDetailPage'
import { AssistantPage } from '@/features/assistant/pages/AssistantPage'
import { AccountPage } from '@/features/account/pages/AccountPage'
import { NotificationsPage } from '@/features/notifications/pages/NotificationsPage'

export const router = createBrowserRouter([
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
])
