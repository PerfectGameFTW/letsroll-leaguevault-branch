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
import AdminPage from "@/pages/admin-page";
import OrganizationsPage from "@/pages/organizations-page";
import { useEffect, useRef, FC } from "react";
import { initializeSquare } from "./lib/square";
import { useToast } from "@/hooks/use-toast";
import { AdminRouteGuard } from "@/components/admin-route-guard";
import { OrganizationRouteGuard } from "@/components/organization-route-guard";
import { OrganizationAdminRouteGuard } from "@/components/organization-admin-route-guard";
import { AuthRouteGuard } from "@/components/auth-route-guard";
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
        // If not authenticated, redirect to login
        console.log("[Router] User not authenticated, redirecting to login");
        navigate('/login');
      } else if (currentUserResponse?.data?.organizationId) {
        // Check if user is an organization admin
        if (currentUserResponse?.data?.isOrganizationAdmin || currentUserResponse?.data?.isAdmin) {
          // If user is an org admin or system admin, go to home
          console.log("[Router] User is organization admin, redirecting to home");
          navigate('/home');
        } else {
          // Regular organization user goes to leagues
          console.log("[Router] User authenticated with organization, redirecting to leagues");
          navigate('/leagues');
        }
      } else {
        // If authenticated but no organization, go to bowler dashboard
        console.log("[Router] User authenticated without organization, redirecting to bowler dashboard");
        navigate('/bowler-dashboard');
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
      <Route path="/not-found" component={NotFound} />

      {/* Root route with redirect handler */}
      <Route path="/" component={RootRedirectHandler} />

      {/* User-specific routes (requires authentication) */}
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

      {/* Organization-specific routes */}
      <Route path="/home">
        <OrganizationRouteGuard>
          <HomePage />
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
      <Route path="/admin">
        <AdminRouteGuard>
          <AdminPage />
        </AdminRouteGuard>
      </Route>
      
      <Route path="/organizations">
        <AdminRouteGuard>
          <OrganizationsPage />
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
        console.log('[App] Square initialized successfully');
      } catch (error) {
        console.error('[App] Square initialization attempt failed:', error);
        initializationAttempts.current++;

        if (initializationAttempts.current < maxAttempts) {
          // Retry with exponential backoff
          const delay = Math.min(1000 * Math.pow(2, initializationAttempts.current), 5000);
          console.log(`[App] Retrying Square initialization in ${delay}ms (attempt ${initializationAttempts.current}/${maxAttempts})`);
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