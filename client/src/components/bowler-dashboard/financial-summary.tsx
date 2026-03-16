import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { Bowler, League, Payment } from "@shared/schema";
import { calculateFinancials } from "@/lib/financial-utils";

interface FinancialSummaryProps {
  bowler: Bowler;
  league: League;
  payments: Payment[];
  teamName: string;
  leagueName: string;
}

const FinancialSummary = ({ bowler, league, payments, teamName, leagueName }: FinancialSummaryProps) => {
  const {
    weeksPassed: weeksDue,
    totalWeeksInSeason,
    totalDueToDate: totalSeasonDues,
    totalPaid: totalPaidAmount,
    amountPastDue,
    fullSeasonAmount,
    remainingBalance,
    finalTwoWeeks,
    finalTwoWeeksDue,
  } = calculateFinancials(league, payments);

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
              {weeksDue} week{weeksDue === 1 ? "" : "s"}
              {finalTwoWeeksDue ? " + final 2 weeks" : ""} at ${(
                (league?.weeklyFee || 0) / 100
              ).toFixed(2)}/week
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
