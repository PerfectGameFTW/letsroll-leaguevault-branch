import { Switch, Route } from "wouter";
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
import { useEffect, useRef } from "react";
import { initializeSquare } from "./lib/square";
import { useToast } from "@/hooks/use-toast";

function Router() {
  useEffect(() => {
    // Prefetch data when router mounts
    prefetchQueries().catch(console.error);
  }, []);

  return (
    <Switch>
      {/* Authentication routes */}
      <Route path="/sign-up" component={SignUpPage} />
      <Route path="/login" component={LoginPage} />

      {/* Protected routes */}
      <Route path="/bowler-dashboard" component={BowlerDashboardPage} />
      <Route path="/bowlers/:bowlerId/payment-setup" component={BowlerPaymentSetupPage} />
      <Route path="/" component={HomePage} />
      <Route path="/leagues" component={LeaguesPage} />
      <Route path="/leagues/:leagueId" component={LeagueViewPage} />
      <Route path="/leagues/:leagueId/teams" component={TeamsPage} />
      <Route path="/leagues/:leagueId/scores" component={LeagueScoresPage} />
      <Route path="/leagues/:leagueId/weekly-payments" component={WeeklyPaymentsPage} />
      <Route path="/teams/:teamId" component={TeamViewPage} />
      <Route path="/bowlers" component={BowlersPage} />
      <Route path="/bowlers/:bowlerId" component={BowlerViewPage} />
      <Route path="/bowlers/:bowlerId/scores" component={BowlerScoresPage} />
      <Route path="/payment-history" component={PaymentHistoryPage} />
      <Route path="/payments" component={PaymentsPage} />
      <Route path="/reports" component={ReportsPage} />
      <Route path="/reports/leagues/:leagueId/past-due" component={LeaguePastDuePage} />
      <Route path="/reports/past-due" component={PastDuePage} />
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