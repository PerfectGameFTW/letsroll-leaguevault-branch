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
import type { League, Team, Bowler, Payment, BowlerLeague } from "@shared/schema";
import { startOfToday } from "date-fns";
import { Link } from "wouter";

export default function PastDuePage() {
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

  const { data: bowlerLeaguesResponse, isLoading: loadingBowlerLeagues } = useQuery<{ data: BowlerLeague[] }>({
    queryKey: ["/api/bowler-leagues-new"],
    queryFn: async () => {
      const response = await fetch('/api/bowler-leagues-new');
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
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  // Debug logs for incoming data
  console.log('Active Bowlers:', bowlers.filter(bowler => bowler.active));
  console.log('Bowler Leagues:', bowlerLeagues);
  console.log('Leagues:', leagues);
  console.log('Teams:', teams);
  console.log('Payments:', payments);

  // Calculate past due details for each bowler in each league
  const pastDueBowlers = bowlers
    .filter(bowler => bowler.active)
    .flatMap(bowler => {
      // Get all league associations for this bowler
      const bowlerAssociations = bowlerLeagues.filter(bl => bl.bowlerId === bowler.id);
      console.log(`Associations for bowler ${bowler.name}:`, bowlerAssociations);

      return bowlerAssociations.map(association => {
        const league = leagues.find(l => l.id === association.leagueId);
        const team = teams.find(t => t.id === association.teamId);

        console.log(`League and team for ${bowler.name}:`, { league, team });

        if (!league || !team) {
          console.log(`Skipping ${bowler.name} - missing league or team`);
          return null;
        }

        if (!league.seasonStart) {
          console.log(`Skipping ${bowler.name} - league ${league.name} has no season start date`);
          return null;
        }

        // Get payments for this bowler in this specific league
        const leaguePayments = payments.filter(p =>
          p.bowlerId === bowler.id &&
          p.leagueId === league.id &&
          p.status === 'paid'
        );

        console.log(`Payments for ${bowler.name} in league ${league.name}:`, leaguePayments);

        const totalPaid = leaguePayments.reduce((sum, p) => sum + p.amount, 0);
        const today = startOfToday();
        const seasonStart = new Date(league.seasonStart);
        const weeksPassed = Math.max(0, Math.floor(
          (today.getTime() - seasonStart.getTime()) / (7 * 24 * 60 * 60 * 1000)
        ));

        const dueToDate = league.weeklyFee * weeksPassed;
        const pastDueAmount = Math.max(0, dueToDate - totalPaid);
        const weeksPastDue = Math.floor(pastDueAmount / league.weeklyFee);

        console.log(`Calculations for ${bowler.name} in ${league.name}:`, {
          totalPaid,
          weeksPassed,
          dueToDate,
          pastDueAmount,
          weeksPastDue,
          seasonStart: league.seasonStart,
        });

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

  console.log('Final pastDueBowlers:', pastDueBowlers);

  return (
    <Layout>
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
                      <Link href={`/bowlers/${item.bowler.id}`} className="hover:underline">
                        {item.bowler.name}
                      </Link>
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
    </Layout>
  );
}