import { Switch, Route, Redirect } from "wouter";
import { queryClient, prefetchQueries } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import HomePage from "@/pages/home-page";
import LeaguesPage from "@/pages/leagues-page";
import LeagueViewPage from "@/pages/league-view-page";
import TeamsPage from "@/pages/teams-page";
import TeamViewPage from "@/pages/team-view-page";
import BowlersPage from "@/pages/bowlers-page";
import BowlerViewPage from "@/pages/bowler-view-page";
import BowlerScoresPage from "@/pages/bowler-scores-page";
import BowlerPaymentSetupPage from "@/pages/bowler-payment-setup";
import LeagueScoresPage from "@/pages/league-scores-page";
import PaymentsPage from "@/pages/payments-page";
import PaymentHistoryPage from "@/pages/payment-history-page";
import WeeklyPaymentsPage from "@/pages/weekly-payments-page";
import ReportsPage from "@/pages/reports-page";
import LeaguePastDuePage from "@/pages/league-past-due-page";
import PastDuePage from "@/pages/past-due-page";
import SignUpPage from "@/pages/sign-up-page";
import LoginPage from "@/pages/login-page";
import BowlerDashboardPage from "@/pages/bowler-dashboard-page";
import AdminLinkBowlerPage from "@/pages/admin-link-bowler";
import OrganizationsPage from "@/pages/organizations-page";
import LocationsPage from "@/pages/locations-page";
import UsersPage from "@/pages/users-page";
import SetPasswordPage from "@/pages/set-password-page";
import ProfileSettingsPage from "@/pages/profile-settings-page";
import ClaimBowlerPage from "@/pages/claim-bowler-page";
import { useEffect, useRef, FC } from "react";
import { initializeSquare } from "./lib/square";
import { useToast } from "@/hooks/use-toast";
import { AdminRouteGuard } from "@/components/admin-route-guard";
import { OrganizationRouteGuard } from "@/components/organization-route-guard";
import { OrganizationAdminRouteGuard } from "@/components/organization-admin-route-guard";
import { AuthRouteGuard } from "@/components/auth-route-guard";
import { SystemAdminRouteGuard } from "@/components/system-admin-route-guard";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type { ApiResponse } from "@shared/schema";

// Root redirect handler component
const RootRedirectHandler: FC = () => {
  const [, navigate] = useLocation();
  
  // Fetch current user to check authentication status
  const { data: currentUserResponse, isLoading, error } = useQuery<ApiResponse<any>>({
    queryKey: ['/api/user'],
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  useEffect(() => {
    if (!isLoading) {
      if (error || !currentUserResponse?.data) {
        navigate('/login');
      } else {
        const user = currentUserResponse.data;
        const isAdmin = user.isOrganizationAdmin || user.isAdmin;

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

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return null;
};

function Router() {
  useEffect(() => {
    // Prefetch data when router mounts
    prefetchQueries().catch(console.error);
  }, []);

  return (
    <Switch>
      {/* Public routes */}
      <Route path="/sign-up" component={SignUpPage} />
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
      
      <Route path="/bowlers/:bowlerId/payment-setup">
        <AuthRouteGuard>
          <BowlerPaymentSetupPage />
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
      
      {/* Fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const { toast } = useToast();
  const initializationAttempts = useRef(0);
  const maxAttempts = 3;
  const initialized = useRef(false);

  useEffect(() => {
    async function initSquare() {
      // Skip if already initialized or max attempts reached
      if (initialized.current || initializationAttempts.current >= maxAttempts) {
        return;
      }

      try {
        await initializeSquare();
        initialized.current = true;
        initializationAttempts.current = 0;
      } catch (error) {
        console.error('[App] Square initialization attempt failed:', error);
        initializationAttempts.current++;

        if (initializationAttempts.current < maxAttempts) {
          // Retry with exponential backoff
          const delay = Math.min(1000 * Math.pow(2, initializationAttempts.current), 5000);
          setTimeout(initSquare, delay);
        } else {
          // Only show error toast if all retries fail
          console.error('[App] Square initialization failed after all attempts');
          toast({
            title: "Square Integration Notice",
            description: "Payment system initialization delayed. Credit card payments may be temporarily unavailable.",
            variant: "default",
          });
          // Reset for potential future attempts
          initializationAttempts.current = 0;
        }
      }
    }

    initSquare();

    // Cleanup function
    return () => {
      initialized.current = false;
      initializationAttempts.current = 0;
    };
  }, [toast]);

  return (
    <QueryClientProvider client={queryClient}>
      <Router />
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;