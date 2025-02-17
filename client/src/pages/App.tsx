import { Route, Switch } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { queryClient } from "@/lib/queryClient";

// Pages
import HomePage from "@/pages/home-page";
import BowlersPage from "@/pages/bowlers-page";
import BowlerViewPage from "@/pages/bowler-view-page";
import LeaguesPage from "@/pages/leagues-page";
import LeagueViewPage from "@/pages/league-view-page";
import TeamsPage from "@/pages/teams-page";
import TeamViewPage from "@/pages/team-view-page";
import PaymentsPage from "@/pages/payments-page";
import WeeklyPaymentsPage from "@/pages/weekly-payments-page";
import PaymentHistoryPage from "@/pages/payment-history-page";
import ReportsPage from "@/pages/reports-page";
import PastDuePage from "@/pages/past-due-page";
import LeaguePastDuePage from "@/pages/league-past-due-page";
import BowlerDashboardPage from "@/pages/bowler-dashboard-page";
import ScoresPage from "@/pages/scores-page";
import LeagueScoresPage from "@/pages/league-scores-page";
import BowlerScoresPage from "@/pages/bowler-scores-page";
import LoginPage from "@/pages/login-page";
import SignUpPage from "@/pages/sign-up-page";
import NotFoundPage from "@/pages/not-found";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/bowlers" component={BowlersPage} />
        <Route path="/bowlers/:bowlerId" component={BowlerViewPage} />
        <Route path="/leagues" component={LeaguesPage} />
        <Route path="/leagues/:leagueId" component={LeagueViewPage} />
        <Route path="/leagues/:leagueId/teams" component={TeamsPage} />
        <Route path="/teams/:teamId" component={TeamViewPage} />
        <Route path="/payments" component={PaymentsPage} />
        <Route path="/payments/weekly" component={WeeklyPaymentsPage} />
        <Route path="/payment-history" component={PaymentHistoryPage} />
        <Route path="/reports" component={ReportsPage} />
        <Route path="/reports/past-due" component={PastDuePage} />
        <Route path="/reports/leagues/:leagueId/past-due" component={LeaguePastDuePage} />
        <Route path="/bowler-dashboard" component={BowlerDashboardPage} />
        <Route path="/scores" component={ScoresPage} />
        <Route path="/leagues/:leagueId/scores" component={LeagueScoresPage} />
        <Route path="/bowlers/:bowlerId/scores" component={BowlerScoresPage} />
        <Route path="/login" component={LoginPage} />
        <Route path="/sign-up" component={SignUpPage} />
        <Route component={NotFoundPage} />
      </Switch>
      <Toaster />
    </QueryClientProvider>
  );
}
