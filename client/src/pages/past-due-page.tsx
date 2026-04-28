import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { ErrorBoundary } from "@/components/error-boundary";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { PageLoadingState } from "@/components/page-states";
import type { League, Team, Bowler, Payment, BowlerLeague, BowlerWithAccount } from "@shared/schema";
import { getTotalPaidAmount, calculateBowlerPastDue } from "@/lib/financial-utils";
import { Link } from "wouter";

export default function PastDuePage() {
  const { data: leaguesResponse, isLoading: loadingLeagues } = useQuery<{ success: true, data: League[] }>({
    queryKey: ["/api/leagues"],
    queryFn: async () => {
      const response = await fetch('/api/leagues');
      if (!response.ok) {
        throw new Error('Failed to fetch leagues');
      }
      return response.json();
    }
  });
  const leagues = leaguesResponse?.data || [];

  const { data: teamsResponse, isLoading: loadingTeams } = useQuery<{ success: true, data: Team[] }>({
    queryKey: ["/api/teams"],
    queryFn: async () => {
      const response = await fetch('/api/teams');
      if (!response.ok) {
        throw new Error('Failed to fetch teams');
      }
      return response.json();
    }
  });
  const teams = teamsResponse?.data || [];

  const { data: bowlersResponse, isLoading: loadingBowlers } = useQuery<{ success: true, data: BowlerWithAccount[] }>({
    queryKey: ["/api/bowlers"],
    queryFn: async () => {
      const response = await fetch('/api/bowlers');
      if (!response.ok) {
        throw new Error('Failed to fetch bowlers');
      }
      return response.json();
    }
  });
  const bowlers = bowlersResponse?.data || [];

  const { data: bowlerLeaguesResponse, isLoading: loadingBowlerLeagues } = useQuery<{ success: true, data: BowlerLeague[] }>({
    queryKey: ["/api/bowler-leagues", { enriched: true }],
    queryFn: async () => {
      const response = await fetch('/api/bowler-leagues?enriched=true');
      if (!response.ok) {
        throw new Error('Failed to fetch bowler leagues');
      }
      return response.json();
    }
  });
  const bowlerLeagues = bowlerLeaguesResponse?.data || [];

  const { data: paymentsResponse, isLoading: loadingPayments } = useQuery<{ data: Payment[] }>({
    queryKey: ["/api/payments"],
    queryFn: async () => {
      const response = await fetch('/api/payments');
      if (!response.ok) {
        throw new Error('Failed to fetch payments');
      }
      return response.json();
    }
  });
  const payments = paymentsResponse?.data || [];

  if (loadingLeagues || loadingTeams || loadingBowlers || loadingPayments || loadingBowlerLeagues) {
    return (
      <Layout>
        <PageLoadingState />
      </Layout>
    );
  }

  // Calculate past due details for each bowler in each league
  const pastDueBowlers = bowlers
    .filter(bowler => bowler.active)
    .flatMap(bowler => {
      // Get all league associations for this bowler
      const bowlerAssociations = bowlerLeagues.filter(bl => bl.bowlerId === bowler.id);

      return bowlerAssociations.map(association => {
        const league = leagues.find(l => l.id === association.leagueId);
        const team = teams.find(t => t.id === association.teamId);

        if (!league || !team) {
          return null;
        }

        if (!league.seasonStart) {
          return null;
        }

        const totalPaid = getTotalPaidAmount(
          payments.filter(p => p.bowlerId === bowler.id && p.leagueId === league.id)
        );

        const pastDueAmount = calculateBowlerPastDue(league, totalPaid);
        const weeksPastDue = Math.floor(pastDueAmount / league.weeklyFee);

        return pastDueAmount > 0 ? {
          bowler,
          team,
          league,
          weeksPastDue,
          pastDueAmount,
        } : null;
      });
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.pastDueAmount - a.pastDueAmount);

  return (
    <Layout>
      <ErrorBoundary level="section">
      <div className="space-y-6">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground flex items-center">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Reports
        </Link>

        <div>
          <h1 className="text-2xl font-bold mb-2">Past Due Balances</h1>
          <p className="text-muted-foreground mb-6">
            List of bowlers with past due balances
          </p>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bowler Name</TableHead>
                <TableHead>League</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Weeks Past Due</TableHead>
                <TableHead>Past Due Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pastDueBowlers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-4">
                    No past due balances found
                  </TableCell>
                </TableRow>
              ) : (
                pastDueBowlers.map(item => (
                  <TableRow key={`${item.bowler.id}-${item.league.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className={`h-4 w-4 ${item.bowler.hasAccount ? "text-green-500" : "text-muted-foreground/40"}`} />
                        <Link href={`/bowlers/${item.bowler.id}?from=past-due`} className="hover:underline">
                          {item.bowler.name}
                        </Link>
                      </div>
                    </TableCell>
                    <TableCell>{item.league.name}</TableCell>
                    <TableCell>{item.team.name}</TableCell>
                    <TableCell>{item.weeksPastDue}</TableCell>
                    <TableCell className="text-destructive">
                      ${(item.pastDueAmount / 100).toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      </ErrorBoundary>
    </Layout>
  );
}