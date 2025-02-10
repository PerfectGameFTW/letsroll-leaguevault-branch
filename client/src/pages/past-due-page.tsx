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

  const { data: bowlerLeaguesResponse, isLoading: loadingBowlerLeagues } = useQuery<{ data: { data: { id: number; bowlerId: number; leagueId: number; teamId: number; order: number }[] } }>({
    queryKey: ["/api/bowler-leagues"],
    queryFn: async () => {
      const response = await fetch('/api/bowler-leagues');
      if (!response.ok) {
        throw new Error('Failed to fetch bowler leagues');
      }
      return response.json();
    }
  });
  const bowlerLeagues = bowlerLeaguesResponse?.data?.data || [];

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

  // Calculate past due details with proper type checking
  const pastDueBowlers = bowlers
    .filter(bowler => bowler.active)
    .map(bowler => {
      // Find all league associations for this bowler
      const bowlerLeagueAssociations = bowlerLeagues.filter(bl => bl.bowlerId === bowler.id);

      // Calculate past due for each league association
      const leagueDues = bowlerLeagueAssociations.map(association => {
        const team = teams.find(t => t.id === association.teamId);
        if (!team) return null;

        const league = leagues.find(l => l.id === association.leagueId);
        if (!league) return null;

        const bowlerPayments = payments
          .filter(p => p.bowlerId === bowler.id && p.status === 'paid')
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
          league,
          weeksPastDue,
          pastDueAmount,
        };
      }).filter((item): item is NonNullable<typeof item> => 
        item !== null && item.pastDueAmount > 0
      );

      return leagueDues;
    })
    .flat()
    .sort((a, b) => b.pastDueAmount - a.pastDueAmount);

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
              {pastDueBowlers.map(item => (
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
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </Layout>
  );
}