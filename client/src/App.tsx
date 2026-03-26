import { Switch, Route, Redirect } from "wouter";
import { queryClient, prefetchQueries } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { lazy, Suspense, useEffect, FC } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import { AdminRouteGuard } from "@/components/admin-route-guard";
import { OrganizationRouteGuard } from "@/components/organization-route-guard";
import { OrganizationAdminRouteGuard } from "@/components/organization-admin-route-guard";
import { AuthRouteGuard } from "@/components/auth-route-guard";
import { SystemAdminRouteGuard } from "@/components/system-admin-route-guard";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PageLoadingState } from "@/components/page-states";
import type { ApiResponse, User } from "@shared/schema";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login-page";

const HomePage = lazy(() => import("@/pages/home-page"));
const LeaguesPage = lazy(() => import("@/pages/leagues-page"));
const LeagueViewPage = lazy(() => import("@/pages/league-view-page"));
const TeamsPage = lazy(() => import("@/pages/teams-page"));
const TeamViewPage = lazy(() => import("@/pages/team-view-page"));
const BowlersPage = lazy(() => import("@/pages/bowlers-page"));
const BowlerViewPage = lazy(() => import("@/pages/bowler-view-page"));
const BowlerScoresPage = lazy(() => import("@/pages/bowler-scores-page"));
const LeagueScoresPage = lazy(() => import("@/pages/league-scores-page"));
const PaymentsPage = lazy(() => import("@/pages/payments-page"));
const PaymentHistoryPage = lazy(() => import("@/pages/payment-history-page"));
const WeeklyPaymentsPage = lazy(() => import("@/pages/weekly-payments-page"));
const ReportsPage = lazy(() => import("@/pages/reports-page"));
const LeaguePastDuePage = lazy(() => import("@/pages/league-past-due-page"));
const PastDuePage = lazy(() => import("@/pages/past-due-page"));
const SignUpPage = lazy(() => import("@/pages/sign-up-page"));
const BowlerDashboardPage = lazy(() => import("@/pages/bowler-dashboard-page"));
const AdminLinkBowlerPage = lazy(() => import("@/pages/admin-link-bowler"));
const OrganizationsPage = lazy(() => import("@/pages/organizations-page"));
const LocationsPage = lazy(() => import("@/pages/locations-page"));
const UsersPage = lazy(() => import("@/pages/users-page"));
const SetPasswordPage = lazy(() => import("@/pages/set-password-page"));
const ProfileSettingsPage = lazy(() => import("@/pages/profile-settings-page"));
const ClaimBowlerPage = lazy(() => import("@/pages/claim-bowler-page"));
const EmailTemplatesPage = lazy(() => import("@/pages/email-templates-page"));
const IntegrationsPage = lazy(() => import("@/pages/integrations-page"));

function PageLoader() {
  return <PageLoadingState />;
}

const RootRedirectHandler: FC = () => {
  const [, navigate] = useLocation();
  
  const { data: currentUserResponse, isLoading, error } = useQuery<ApiResponse<User>>({
    queryKey: ['/api/user'],
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    if (!isLoading) {
      if (error || !currentUserResponse?.data) {
        navigate('/login');
      } else {
        const user = currentUserResponse.data;
        const isAdmin = user.role === 'system_admin' || user.role === 'org_admin';

        if (isAdmin && user.organizationId) {
          navigate('/home');
        } else if (user.bowlerId) {
          navigate('/bowler-dashboard');
        } else if (user.organizationId) {
          navigate('/leagues');
        } else {
          navigate('/login');
        }
      }
    }
  }, [isLoading, error, currentUserResponse, navigate]);

  if (isLoading) {
    return <PageLoader />;
  }

  return null;
};

function Router() {
  const { data: userData } = useQuery<ApiResponse<User>>({
    queryKey: ['/api/user'],
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    if (userData?.data) {
      const user = userData.data;
      const isAdmin = user.role === 'system_admin' || user.role === 'org_admin';
      if (isAdmin) {
        prefetchQueries('admin').catch(console.error);
      } else if (user.bowlerId) {
        prefetchQueries('bowler').catch(console.error);
      }
    }
  }, [userData]);

  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        {/* Public routes */}
        <Route path="/sign-up" component={SignUpPage} />
        <Route path="/signup" component={SignUpPage} />
        <Route path="/login" component={LoginPage} />
        <Route path="/set-password" component={SetPasswordPage} />
        <Route path="/claim-bowler">
          <AuthRouteGuard>
            <ClaimBowlerPage />
          </AuthRouteGuard>
        </Route>
        <Route path="/not-found" component={NotFound} />

        {/* Root route with redirect handler */}
        <Route path="/" component={RootRedirectHandler} />

        {/* System Admin specific routes */}
        <Route path="/bowler-dashboard">
          <AuthRouteGuard>
            <BowlerDashboardPage />
          </AuthRouteGuard>
        </Route>
        
        <Route path="/payment-history">
          <AuthRouteGuard>
            <PaymentHistoryPage />
          </AuthRouteGuard>
        </Route>

        <Route path="/profile">
          <AuthRouteGuard>
            <ProfileSettingsPage />
          </AuthRouteGuard>
        </Route>

        {/* Organization-specific routes */}
        <Route path="/home">
          <OrganizationRouteGuard>
            <HomePage />
          </OrganizationRouteGuard>
        </Route>
        
        <Route path="/locations">
          <OrganizationRouteGuard>
            <LocationsPage />
          </OrganizationRouteGuard>
        </Route>
        
        <Route path="/leagues">
          <OrganizationRouteGuard>
            <LeaguesPage />
          </OrganizationRouteGuard>
        </Route>
        
        <Route path="/leagues/:leagueId">
          <OrganizationRouteGuard>
            <LeagueViewPage />
          </OrganizationRouteGuard>
        </Route>
        
        <Route path="/leagues/:leagueId/teams">
          <OrganizationRouteGuard>
            <TeamsPage />
          </OrganizationRouteGuard>
        </Route>
        
        <Route path="/leagues/:leagueId/scores">
          <OrganizationRouteGuard>
            <LeagueScoresPage />
          </OrganizationRouteGuard>
        </Route>
        
        <Route path="/teams/:teamId">
          <OrganizationRouteGuard>
            <TeamViewPage />
          </OrganizationRouteGuard>
        </Route>
        
        <Route path="/bowlers">
          <OrganizationRouteGuard>
            <BowlersPage />
          </OrganizationRouteGuard>
        </Route>
        
        <Route path="/bowlers/:bowlerId">
          <OrganizationRouteGuard>
            <BowlerViewPage />
          </OrganizationRouteGuard>
        </Route>
        
        <Route path="/bowlers/:bowlerId/scores">
          <OrganizationRouteGuard>
            <BowlerScoresPage />
          </OrganizationRouteGuard>
        </Route>

        {/* Organization Admin routes */}
        <Route path="/leagues/:leagueId/weekly-payments">
          <OrganizationAdminRouteGuard>
            <WeeklyPaymentsPage />
          </OrganizationAdminRouteGuard>
        </Route>
        
        <Route path="/payments">
          <OrganizationAdminRouteGuard>
            <PaymentsPage />
          </OrganizationAdminRouteGuard>
        </Route>
        
        <Route path="/reports">
          <OrganizationAdminRouteGuard>
            <ReportsPage />
          </OrganizationAdminRouteGuard>
        </Route>
        
        <Route path="/reports/leagues/:leagueId/past-due">
          <OrganizationAdminRouteGuard>
            <LeaguePastDuePage />
          </OrganizationAdminRouteGuard>
        </Route>
        
        <Route path="/reports/past-due">
          <OrganizationAdminRouteGuard>
            <PastDuePage />
          </OrganizationAdminRouteGuard>
        </Route>

        {/* System Admin routes */}
        <Route path="/organizations">
          <AdminRouteGuard>
            <OrganizationsPage />
          </AdminRouteGuard>
        </Route>
        
        <Route path="/admin/link-bowler">
          <AdminRouteGuard>
            <AdminLinkBowlerPage />
          </AdminRouteGuard>
        </Route>

        <Route path="/users">
          <AdminRouteGuard>
            <UsersPage />
          </AdminRouteGuard>
        </Route>

        <Route path="/email-templates">
          <AdminRouteGuard>
            <EmailTemplatesPage />
          </AdminRouteGuard>
        </Route>

        <Route path="/integrations">
          <OrganizationAdminRouteGuard>
            <IntegrationsPage />
          </OrganizationAdminRouteGuard>
        </Route>
        
        {/* Fallback route */}
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('app-mounted'));
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary level="page">
        <Router />
      </ErrorBoundary>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
