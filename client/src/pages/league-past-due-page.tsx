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
import { Link, useParams } from "wouter";

export default function LeaguePastDuePage() {
  const params = useParams();
  const leagueId = parseInt(params.leagueId!);

  const { data: league, isLoading: loadingLeague } = useQuery<{ data: League }>({
    queryKey: [`/api/leagues/${leagueId}`],
    queryFn: async () => {
      const response = await fetch(`/api/leagues/${leagueId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch league');
      }
      return response.json();
    }
  });

  const { data: teamsResponse, isLoading: loadingTeams } = useQuery<{ data: { data: Team[] } }>({
    queryKey: ["/api/teams"],
    queryFn: async () => {
      const response = await fetch('/api/teams');
      if (!response.ok) {
        throw new Error('Failed to fetch teams');
      }
      return response.json();
    }
  });

  const { data: bowlerLeaguesResponse, isLoading: loadingBowlerLeagues } = useQuery<{ data: BowlerLeague[] }>({
    queryKey: ["/api/bowler-leagues", leagueId],
    queryFn: async () => {
      const response = await fetch(`/api/bowler-leagues?leagueId=${leagueId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch bowler leagues');
      }
      return response.json();
    },
    enabled: !!leagueId,
  });

  const { data: bowlersResponse, isLoading: loadingBowlers } = useQuery<{ data: BowlerWithAccount[] }>({
    queryKey: ["/api/bowlers"],
    queryFn: async () => {
      const response = await fetch('/api/bowlers');
      if (!response.ok) {
        throw new Error('Failed to fetch bowlers');
      }
      return response.json();
    }
  });

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

  if (loadingLeague || loadingTeams || loadingBowlers || loadingPayments || loadingBowlerLeagues) {
    return (
      <Layout>
        <PageLoadingState />
      </Layout>
    );
  }

  if (!league?.data) {
    return (
      <Layout>
        <div>League not found</div>
      </Layout>
    );
  }

  // Get teams for this league
  const teams = teamsResponse?.data?.data || [];
  const leagueTeams = teams.filter(team => team.leagueId === leagueId) || [];

  // Get bowlers, bowler leagues and payments
  const bowlers = bowlersResponse?.data || [];
  const bowlerLeagues = bowlerLeaguesResponse?.data || [];
  const payments = paymentsResponse?.data || [];

  // Get bowlers for these teams using bowler leagues
  const leagueBowlers = bowlers.filter(bowler => 
    bowlerLeagues.some(bl => 
      bl.bowlerId === bowler.id && 
      bl.leagueId === leagueId &&
      leagueTeams.some(team => team.id === bl.teamId)
    )
  ) || [];

  // Calculate past due details for each bowler in this league
  const pastDueBowlers = leagueBowlers
    .filter(bowler => bowler.active)
    .map(bowler => {
      const bowlerLeague = bowlerLeagues.find(bl => 
        bl.bowlerId === bowler.id && 
        bl.leagueId === leagueId
      );
      if (!bowlerLeague) return null;

      const team = teams?.find(t => t.id === bowlerLeague.teamId);
      if (!team) return null;

      const bowlerPaidAmount = getTotalPaidAmount(
        (payments || []).filter(p => p.bowlerId === bowler.id)
      );

      const pastDueAmount = calculateBowlerPastDue(league.data, bowlerPaidAmount);
      const weeksPastDue = Math.floor(pastDueAmount / league.data.weeklyFee);

      return {
        bowler,
        team,
        weeksPastDue,
        pastDueAmount,
      };
    })
    .filter(item => item && item.pastDueAmount > 0)
    .sort((a, b) => (b?.pastDueAmount || 0) - (a?.pastDueAmount || 0));

  return (
    <Layout>
      <ErrorBoundary level="section">
      <div className="space-y-6">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground flex items-center">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Reports
        </Link>

        <div>
          <h1 className="text-2xl font-bold mb-2">{league.data.name} - Past Due Balances</h1>
          <p className="text-muted-foreground mb-6">
            List of bowlers with past due balances in {league.data.name}
          </p>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bowler Name</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Weeks Past Due</TableHead>
                <TableHead>Past Due Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pastDueBowlers?.map(item => item && (
                <TableRow key={item.bowler.id}>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className={`h-4 w-4 ${item.bowler.hasAccount ? "text-green-500" : "text-muted-foreground/40"}`} />
                      <Link href={`/bowlers/${item.bowler.id}`} className="hover:underline">
                        {item.bowler.name}
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell>{item.team.name}</TableCell>
                  <TableCell>{item.weeksPastDue}</TableCell>
                  <TableCell className="text-destructive">
                    ${(item.pastDueAmount / 100).toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      </ErrorBoundary>
    </Layout>
  );
}