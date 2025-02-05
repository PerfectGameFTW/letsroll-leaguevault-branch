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
import { format } from "date-fns";

export default function ReportsPage() {
  const { data: leagues, isLoading: loadingLeagues } = useQuery<League[]>({
    queryKey: ["/api/leagues"],
  });

  const { data: teams, isLoading: loadingTeams } = useQuery<Team[]>({
    queryKey: ["/api/teams"],
  });

  const { data: bowlers, isLoading: loadingBowlers } = useQuery<Bowler[]>({
    queryKey: ["/api/bowlers"],
  });

  const { data: payments, isLoading: loadingPayments } = useQuery<Payment[]>({
    queryKey: ["/api/payments"],
  });

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
  const leagueFinancials = leagues?.map(league => {
    const leagueTeams = teams?.filter(team => team.leagueId === league.id) || [];
    const leagueBowlers = bowlers?.filter(bowler =>
      leagueTeams.some(team => team.id === bowler.teamId)
    ) || [];

    const leaguePayments = payments?.filter(payment =>
      leagueBowlers.some(bowler => bowler.id === payment.bowlerId)
    ) || [];

    const collected = leaguePayments.reduce((sum, payment) =>
      payment.status === 'paid' ? sum + payment.amount : sum, 0);

    const outstandingBalance = leagueBowlers.reduce((sum, bowler) => {
      if (!bowler.active) return sum;

      const bowlerPayments = leaguePayments
        .filter(p => p.bowlerId === bowler.id && p.status === 'paid')
        .reduce((sum, p) => sum + p.amount, 0);

      const totalDue = league.weeklyFee *
        (league.seasonEnd ? Math.ceil((new Date(league.seasonEnd).getTime() - new Date(league.seasonStart).getTime()) / (7 * 24 * 60 * 60 * 1000)) : 0);

      return sum + (totalDue - bowlerPayments);
    }, 0);

    return {
      ...league,
      collected,
      outstandingBalance,
      activeBowlerCount: leagueBowlers.filter(b => b.active).length,
      teamCount: leagueTeams.length,
    };
  });

  // Calculate overall totals
  const totalCollected = leagueFinancials?.reduce((sum, league) => sum + league.collected, 0) || 0;
  const totalOutstanding = leagueFinancials?.reduce((sum, league) => sum + league.outstandingBalance, 0) || 0;

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

            <Card>
              <CardHeader>
                <CardTitle>Total Outstanding</CardTitle>
                <CardDescription>Total amount pending collection</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-destructive">
                  ${(totalOutstanding / 100).toFixed(2)}
                </p>
              </CardContent>
            </Card>
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
                  <TableHead>Outstanding</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leagueFinancials?.map((league) => (
                  <TableRow key={league.id}>
                    <TableCell>{league.name}</TableCell>
                    <TableCell>{league.activeBowlerCount}</TableCell>
                    <TableCell>{league.teamCount}</TableCell>
                    <TableCell>${(league.collected / 100).toFixed(2)}</TableCell>
                    <TableCell className="text-destructive">
                      ${(league.outstandingBalance / 100).toFixed(2)}
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

        {/* Team Roster Reports */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Team Roster Reports</h2>
          <div className="space-y-4">
            {leagues?.map(league => (
              <Card key={league.id}>
                <CardHeader>
                  <CardTitle>{league.name}</CardTitle>
                  <CardDescription>
                    {format(new Date(league.seasonStart), "MMM d, yyyy")} - {format(new Date(league.seasonEnd), "MMM d, yyyy")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Team</TableHead>
                          <TableHead>Active Bowlers</TableHead>
                          <TableHead>Inactive Bowlers</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {teams
                          ?.filter(team => team.leagueId === league.id)
                          .map(team => {
                            const teamBowlers = bowlers?.filter(bowler => bowler.teamId === team.id) || [];
                            const activeBowlers = teamBowlers.filter(bowler => bowler.active);
                            const inactiveBowlers = teamBowlers.filter(bowler => !bowler.active);

                            return (
                              <TableRow key={team.id}>
                                <TableCell>{team.name}</TableCell>
                                <TableCell>{activeBowlers.length}</TableCell>
                                <TableCell>{inactiveBowlers.length}</TableCell>
                              </TableRow>
                            );
                          })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}