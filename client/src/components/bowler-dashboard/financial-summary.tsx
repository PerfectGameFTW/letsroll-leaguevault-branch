import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { Bowler, League, Payment } from "@shared/schema";
import { differenceInWeeks, startOfToday } from "date-fns";

interface FinancialSummaryProps {
  bowler: Bowler;
  league: League;
  payments: Payment[];
  teamName: string;
  leagueName: string;
}

const FinancialSummary = ({ bowler, league, payments, teamName, leagueName }: FinancialSummaryProps) => {
  const totalPaidPayments = payments.filter(p => p.status === 'paid') || [];
  const totalPaidAmount = totalPaidPayments.reduce((sum, p) => sum + p.amount, 0);

  let weeksDue = 0;
  let totalSeasonDues = 0;
  let totalWeeksInSeason = 0;
  let fullSeasonAmount = 0;
  let amountPastDue = 0;

  if (league?.seasonStart && league.seasonEnd && league.weeklyFee) {
    const seasonStartDate = new Date(league.seasonStart);
    const seasonEndDate = new Date(league.seasonEnd);
    const today = startOfToday();

    if (seasonStartDate && seasonEndDate && today) {
      weeksDue = Math.max(0, differenceInWeeks(today < seasonStartDate ? seasonStartDate : today > seasonEndDate ? seasonEndDate : today, seasonStartDate));
      totalSeasonDues = league.weeklyFee * weeksDue;
      totalWeeksInSeason = differenceInWeeks(seasonEndDate, seasonStartDate);
      fullSeasonAmount = league.weeklyFee * totalWeeksInSeason;
      amountPastDue = totalSeasonDues - totalPaidAmount;
    }
  }

  const remainingBalance = fullSeasonAmount - totalPaidAmount;

  return (
    <>
      <div className="rounded-lg border p-4 space-y-4 mt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Current League</p>
            <p className="text-lg font-semibold">{leagueName || "Not Assigned"}</p>
          </div>
        </div>
        <div>
          <p className="text-sm font-medium text-muted-foreground">Team</p>
          <p className="text-lg font-semibold">{teamName || "Not Assigned"}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Weekly Fee</CardTitle>
            <CardDescription>Regular payment amount</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${((league?.weeklyFee || 0) / 100).toFixed(2)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Amount Due to Date</CardTitle>
            <CardDescription>
              {weeksDue} week{weeksDue === 1 ? "" : "s"} at ${(
                (league?.weeklyFee || 0) / 100
              ).toFixed(2)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${(totalSeasonDues / 100).toFixed(2)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Amount Paid to Date</CardTitle>
            <CardDescription>All payments received</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${(totalPaidAmount / 100).toFixed(2)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Amount Past Due to Date</CardTitle>
            <CardDescription>Unpaid fees for weeks passed</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-destructive">${(amountPastDue / 100).toFixed(2)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Full Season Amount Due</CardTitle>
            <CardDescription>
              {totalWeeksInSeason} week{totalWeeksInSeason === 1 ? "" : "s"} at ${(
                (league?.weeklyFee || 0) / 100
              ).toFixed(2)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${(fullSeasonAmount / 100).toFixed(2)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Full Season Remaining Balance</CardTitle>
            <CardDescription>Amount left to pay</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${(remainingBalance / 100).toFixed(2)}</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default FinancialSummary;
