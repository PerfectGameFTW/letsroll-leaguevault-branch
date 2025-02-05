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
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, Download } from "lucide-react";
import type { League, Team, Bowler, Payment } from "@shared/schema";
import { startOfToday } from "date-fns";
import { Link } from "wouter";
import * as XLSX from 'xlsx';

export default function PastDuePage() {
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

  // Calculate past due details for each bowler
  const pastDueBowlers = bowlers
    ?.filter(bowler => bowler.active && bowler.teamId)
    .map(bowler => {
      const team = teams?.find(t => t.id === bowler.teamId);
      const league = leagues?.find(l => l.id === team?.leagueId);

      if (!team || !league) return null;

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
        league,
        weeksPastDue,
        pastDueAmount,
      };
    })
    .filter(item => item && item.pastDueAmount > 0)
    .sort((a, b) => (b?.pastDueAmount || 0) - (a?.pastDueAmount || 0));

  const handleExport = () => {
    if (!pastDueBowlers?.length) return;

    // Prepare data for Excel
    const excelData = pastDueBowlers.map(item => ({
      'Bowler Name': item?.bowler.name,
      'Email': item?.bowler.email,
      'League': item?.league.name,
      'Team': item?.team.name,
      'Weeks Past Due': item?.weeksPastDue,
      'Past Due Amount': `$${(item?.pastDueAmount / 100).toFixed(2)}`,
    }));

    // Create worksheet
    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Past Due Report');

    // Generate Excel file
    XLSX.writeFile(wb, 'past_due_report.xlsx');
  };

  return (
    <Layout>
      <div className="space-y-6">
        <Link href="/reports" className="text-muted-foreground hover:text-foreground flex items-center">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Reports
        </Link>

        <div>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold mb-2">Past Due Balances</h1>
              <p className="text-muted-foreground">
                List of bowlers with past due balances
              </p>
            </div>
            <Button onClick={handleExport} disabled={!pastDueBowlers?.length}>
              <Download className="h-4 w-4 mr-2" />
              Export to Excel
            </Button>
          </div>
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
              {pastDueBowlers?.map(item => item && (
                <TableRow key={item.bowler.id}>
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