import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { ErrorBoundary } from "@/components/error-boundary";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageLoadingState } from "@/components/page-states";
import type { League, Team, Bowler, Payment, BowlerLeague } from "@shared/schema"; // Added BowlerLeague type
import { Link } from "wouter";
import { calculateBowlerPastDue, getTotalPaidAmount } from "@/lib/financial-utils";

export default function ReportsPage() {
  const { data: leaguesResponse, isLoading: loadingLeagues } = useQuery<{ data: League[] }>({
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

  const { data: teamsResponse, isLoading: loadingTeams } = useQuery<{ data: { data: Team[] } }>({
    queryKey: ["/api/teams"],
    queryFn: async () => {
      const response = await fetch('/api/teams');
      if (!response.ok) {
        throw new Error('Failed to fetch teams');
      }
      const result = await response.json();
      return result;
    }
  });
  const teams = teamsResponse?.data?.data || [];

  const { data: bowlersResponse, isLoading: loadingBowlers } = useQuery<{ data: Bowler[] }>({
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

  const { data: bowlerLeaguesResponse, isLoading: loadingBowlerLeagues } = useQuery<{ data: BowlerLeague[] }>({ // Added query for bowler leagues
    queryKey: ["/api/bowlerleagues"],
    queryFn: async () => {
      const response = await fetch('/api/bowlerleagues');
      if (!response.ok) {
        throw new Error('Failed to fetch bowler leagues');
      }
      return response.json();
    }
  });
  const bowlerLeagues = bowlerLeaguesResponse?.data || [];


  if (loadingLeagues || loadingTeams || loadingBowlers || loadingPayments || loadingBowlerLeagues) {
    return (
      <Layout>
        <PageLoadingState />
      </Layout>
    );
  }

  // Fix the bowler-team relationship logic
  const leagueFinancials = leagues.map(league => {
    const leagueTeams = teams.filter(team => team.leagueId === league.id);

    // Use bowlerLeagues to get the correct bowler-team associations
    const leagueBowlers = bowlers.filter(bowler =>
      bowlerLeagues.some(bl =>
        bl.bowlerId === bowler.id &&
        bl.leagueId === league.id &&
        leagueTeams.some(team => team.id === bl.teamId)
      )
    );

    const leaguePayments = payments.filter(payment =>
      payment.leagueId === league.id &&
      leagueBowlers.some(bowler => bowler.id === payment.bowlerId)
    );

    const collected = leaguePayments.reduce((sum, payment) =>
      payment.status === 'paid' ? sum + payment.amount : sum, 0);

    const pastDueBalance = leagueBowlers.reduce((sum, bowler) => {
      if (!bowler.active) return sum;

      const bowlerPaidAmount = getTotalPaidAmount(
        leaguePayments.filter(p => p.bowlerId === bowler.id)
      );

      return sum + calculateBowlerPastDue(league, bowlerPaidAmount);
    }, 0);

    return {
      ...league,
      collected,
      pastDueBalance,
      activeBowlerCount: leagueBowlers.filter(b => b.active).length,
      teamCount: leagueTeams.length,
    };
  });

  // Calculate overall totals
  const totalCollected = leagueFinancials.reduce((sum, league) => sum + league.collected, 0) || 0;
  const totalPastDue = leagueFinancials.reduce((sum, league) => sum + league.pastDueBalance, 0) || 0;

  return (
    <Layout>
      <ErrorBoundary level="section">
      <div className="space-y-8">
        <h1 className="text-2xl font-bold">Reports</h1>

        <ErrorBoundary level="section">
        <div>
          <h2 className="text-xl font-semibold mb-4">Overall Financial Summary</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Total Collections</CardTitle>
                <CardDescription>Total amount collected across all leagues</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">${(totalCollected / 100).toFixed(2)}</p>
              </CardContent>
            </Card>

            <Link href="/reports/past-due">
              <Card className="transition-colors hover:bg-accent/50 cursor-pointer">
                <CardHeader>
                  <CardTitle>Total Past Due</CardTitle>
                  <CardDescription>Total amount past due to date</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-destructive">
                    ${(totalPastDue / 100).toFixed(2)}
                  </p>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>
        </ErrorBoundary>

        <ErrorBoundary level="section">
        <div>
          <h2 className="text-xl font-semibold mb-4">League Financial Reports</h2>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>League Name</TableHead>
                  <TableHead>Active Bowlers</TableHead>
                  <TableHead>Teams</TableHead>
                  <TableHead>Collections</TableHead>
                  <TableHead>Past Due</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leagueFinancials.map((league) => (
                  <TableRow key={league.id}>
                    <TableCell>
                      <Link
                        href={`/reports/leagues/${league.id}/past-due`}
                        className="hover:underline text-foreground"
                      >
                        {league.name}
                      </Link>
                    </TableCell>
                    <TableCell>{league.activeBowlerCount}</TableCell>
                    <TableCell>{league.teamCount}</TableCell>
                    <TableCell>${(league.collected / 100).toFixed(2)}</TableCell>
                    <TableCell className="text-destructive">
                      ${(league.pastDueBalance / 100).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={league.active ? "default" : "secondary"}>
                        {league.active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
        </ErrorBoundary>
      </div>
      </ErrorBoundary>
    </Layout>
  );
}