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
import { format, startOfToday } from "date-fns";

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

  // Calculate financial summaries
  const totalCollected = payments?.reduce((sum, payment) => 
    payment.status === 'paid' ? sum + payment.amount : sum, 0) || 0;

  const outstandingBalance = bowlers?.reduce((sum, bowler) => {
    if (!bowler.teamId) return sum;
    const team = teams?.find(t => t.id === bowler.teamId);
    if (!team?.leagueId) return sum;
    const league = leagues?.find(l => l.id === team.leagueId);
    if (!league) return sum;
    
    const bowlerPayments = payments?.filter(p => p.bowlerId === bowler.id && p.status === 'paid')
      .reduce((sum, p) => sum + p.amount, 0) || 0;
    
    const totalDue = league.weeklyFee * 
      (league.seasonEnd ? Math.ceil((new Date(league.seasonEnd).getTime() - new Date(league.seasonStart).getTime()) / (7 * 24 * 60 * 60 * 1000)) : 0);
    
    return sum + (totalDue - bowlerPayments);
  }, 0) || 0;

  // Calculate league summaries
  const leagueSummaries = leagues?.map(league => {
    const leagueTeams = teams?.filter(team => team.leagueId === league.id) || [];
    const activeBowlers = bowlers?.filter(bowler => 
      leagueTeams.some(team => team.id === bowler.teamId) && bowler.active
    ) || [];

    return {
      ...league,
      teamCount: leagueTeams.length,
      activeBowlerCount: activeBowlers.length,
    };
  });

  return (
    <Layout>
      <div className="space-y-8">
        <h1 className="text-2xl font-bold">Reports</h1>

        {/* Financial Reports Section */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Financial Reports</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Season-to-Date Collections</CardTitle>
                <CardDescription>Total amount collected from all payments</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">${(totalCollected / 100).toFixed(2)}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Outstanding Balances</CardTitle>
                <CardDescription>Total amount pending collection</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-destructive">
                  ${(outstandingBalance / 100).toFixed(2)}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* League Reports Section */}
        <div>
          <h2 className="text-xl font-semibold mb-4">League Reports</h2>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>League Name</TableHead>
                  <TableHead>Teams</TableHead>
                  <TableHead>Active Bowlers</TableHead>
                  <TableHead>Weekly Fee</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leagueSummaries?.map((league) => (
                  <TableRow key={league.id}>
                    <TableCell>{league.name}</TableCell>
                    <TableCell>{league.teamCount}</TableCell>
                    <TableCell>{league.activeBowlerCount}</TableCell>
                    <TableCell>${(league.weeklyFee / 100).toFixed(2)}</TableCell>
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

        {/* Team Roster Reports Section */}
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
