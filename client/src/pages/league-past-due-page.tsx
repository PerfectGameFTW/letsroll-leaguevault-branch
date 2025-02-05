import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, ArrowLeft } from "lucide-react";
import type { League, Team, Bowler, Payment } from "@shared/schema";
import { startOfToday } from "date-fns";
import { Link, useParams } from "wouter";

export default function LeaguePastDuePage() {
  const params = useParams();
  const leagueId = parseInt(params.leagueId!);

  const { data: league, isLoading: loadingLeague } = useQuery<League>({
    queryKey: [`/api/leagues/${leagueId}`],
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

  if (loadingLeague || loadingTeams || loadingBowlers || loadingPayments) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!league) {
    return (
      <Layout>
        <div>League not found</div>
      </Layout>
    );
  }

  // Get teams for this league
  const leagueTeams = teams?.filter(team => team.leagueId === leagueId) || [];
  
  // Get bowlers for these teams
  const leagueBowlers = bowlers?.filter(bowler => 
    leagueTeams.some(team => team.id === bowler.teamId)
  ) || [];

  // Calculate past due details for each bowler in this league
  const pastDueBowlers = leagueBowlers
    .filter(bowler => bowler.active)
    .map(bowler => {
      const team = teams?.find(t => t.id === bowler.teamId);
      if (!team) return null;

      const bowlerPayments = payments
        ?.filter(p => p.bowlerId === bowler.id && p.status === 'paid')
        .reduce((sum, p) => sum + p.amount, 0) || 0;

      const today = startOfToday();
      const seasonStart = new Date(league.seasonStart);
      const weeksPassed = Math.max(0, Math.floor(
        (today.getTime() - seasonStart.getTime()) / (7 * 24 * 60 * 60 * 1000)
      ));

      const dueToDate = league.weeklyFee * weeksPassed;
      const pastDueAmount = Math.max(0, dueToDate - bowlerPayments);
      const weeksPastDue = Math.floor(pastDueAmount / league.weeklyFee);

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
      <div className="space-y-6">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground flex items-center">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Reports
        </Link>

        <div>
          <h1 className="text-2xl font-bold mb-2">{league.name} - Past Due Balances</h1>
          <p className="text-muted-foreground mb-6">
            List of bowlers with past due balances in {league.name}
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
                    <Link href={`/bowlers/${item.bowler.id}`} className="hover:underline">
                      {item.bowler.name}
                    </Link>
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
    </Layout>
  );
}
