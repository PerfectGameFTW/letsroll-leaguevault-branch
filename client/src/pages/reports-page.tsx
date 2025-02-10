import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
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
import { Loader2 } from "lucide-react";
import type { League, Team, Bowler, Payment } from "@shared/schema";
import { format, isAfter, isBefore, startOfToday } from "date-fns";
import { Link } from "wouter";

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

  const { data: teamsResponse, isLoading: loadingTeams } = useQuery<{ data: Team[] }>({
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

  if (loadingLeagues || loadingTeams || loadingBowlers || loadingPayments) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  // Calculate league-wise financial summaries
  const leagueFinancials = leagues.map(league => {
    const leagueTeams = teams.filter(team => team.leagueId === league.id) || [];
    const leagueBowlers = bowlers.filter(bowler =>
      leagueTeams.some(team => team.id === bowler.teamId)
    ) || [];

    const leaguePayments = payments.filter(payment =>
      leagueBowlers.some(bowler => bowler.id === payment.bowlerId)
    ) || [];

    const collected = leaguePayments.reduce((sum, payment) =>
      payment.status === 'paid' ? sum + payment.amount : sum, 0);

    const pastDueBalance = leagueBowlers.reduce((sum, bowler) => {
      if (!bowler.active) return sum;

      const bowlerPayments = leaguePayments
        .filter(p => p.bowlerId === bowler.id && p.status === 'paid')
        .reduce((sum, p) => sum + p.amount, 0);

      // Calculate the number of weeks from season start to today
      const today = startOfToday();
      const seasonStart = new Date(league.seasonStart);
      const weeksPassed = Math.max(0, Math.floor(
        (today.getTime() - seasonStart.getTime()) / (7 * 24 * 60 * 60 * 1000)
      ));

      // Calculate amount due to date
      const dueToDate = league.weeklyFee * weeksPassed;

      // Only include in past due if there's an actual balance due
      const pastDue = Math.max(0, dueToDate - bowlerPayments);
      return sum + pastDue;
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
      <div className="space-y-8">
        <h1 className="text-2xl font-bold">Reports</h1>

        {/* Overall Financial Summary */}
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

        {/* League-wise Financial Reports */}
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
      </div>
    </Layout>
  );
}