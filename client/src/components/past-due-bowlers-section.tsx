import { useQuery } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "wouter";
import type { League, Team, Bowler, Payment, BowlerLeague } from "@shared/schema";
import { startOfToday } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export function PastDueBowlersSection() {
  const isMobile = useIsMobile();
  const { data: leaguesResponse } = useQuery<{ success: true, data: League[] }>({
    queryKey: ["/api/leagues"],
  });
  const leagues = leaguesResponse?.data || [];

  const { data: teamsResponse } = useQuery<{ success: true, data: Team[] }>({
    queryKey: ["/api/teams"],
  });
  const teams = teamsResponse?.data || [];

  const { data: bowlersResponse } = useQuery<{ success: true, data: Bowler[] }>({
    queryKey: ["/api/bowlers"],
  });
  const bowlers = bowlersResponse?.data || [];

  const { data: bowlerLeaguesResponse } = useQuery<{ success: true, data: BowlerLeague[] }>({
    queryKey: ["/api/bowler-leagues-new"],
  });
  const bowlerLeagues = bowlerLeaguesResponse?.data || [];

  const { data: paymentsResponse } = useQuery<{ data: Payment[] }>({
    queryKey: ["/api/payments"],
  });
  const payments = paymentsResponse?.data || [];

  // Calculate past due details for each bowler in each league
  const pastDueBowlers = bowlers
    .filter(bowler => bowler.active)
    .flatMap(bowler => {
      const bowlerAssociations = bowlerLeagues.filter(bl => bl.bowlerId === bowler.id);

      return bowlerAssociations.map(association => {
        const league = leagues.find(l => l.id === association.leagueId);
        const team = teams.find(t => t.id === association.teamId);

        if (!league || !team || !league.seasonStart) {
          return null;
        }

        const leaguePayments = payments.filter(p =>
          p.bowlerId === bowler.id &&
          p.leagueId === league.id &&
          p.status === 'paid'
        );

        const totalPaid = leaguePayments.reduce((sum, p) => sum + p.amount, 0);
        const today = startOfToday();
        const seasonStart = new Date(league.seasonStart);
        const weeksPassed = Math.max(0, Math.floor(
          (today.getTime() - seasonStart.getTime()) / (7 * 24 * 60 * 60 * 1000)
        ));

        const dueToDate = league.weeklyFee * weeksPassed;
        const pastDueAmount = Math.max(0, dueToDate - totalPaid);
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
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold mb-2">Past Due Balances</h2>
        <p className="text-sm text-muted-foreground">
          Bowlers with outstanding payments
        </p>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bowler Name</TableHead>
              <TableHead>League</TableHead>
              <TableHead className={cn("hidden md:table-cell")}>Team</TableHead>
              <TableHead className={cn("hidden md:table-cell")}>Weeks Past Due</TableHead>
              <TableHead>Past Due Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pastDueBowlers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isMobile ? 3 : 5} className="text-center py-4">
                  No past due balances found
                </TableCell>
              </TableRow>
            ) : (
              pastDueBowlers.slice(0, 5).map(item => (
                <TableRow key={`${item.bowler.id}-${item.league.id}`}>
                  <TableCell>
                    <Link href={`/bowlers/${item.bowler.id}`} className="hover:underline">
                      {item.bowler.name}
                    </Link>
                  </TableCell>
                  <TableCell>{item.league.name}</TableCell>
                  <TableCell className={cn("hidden md:table-cell")}>{item.team.name}</TableCell>
                  <TableCell className={cn("hidden md:table-cell")}>{item.weeksPastDue}</TableCell>
                  <TableCell className="text-destructive">
                    ${(item.pastDueAmount / 100).toFixed(2)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {pastDueBowlers.length > 5 && (
        <div className="text-right">
          <Link href="/past-due" className="text-sm text-primary hover:underline">
            View all past due balances →
          </Link>
        </div>
      )}
    </div>
  );
}
