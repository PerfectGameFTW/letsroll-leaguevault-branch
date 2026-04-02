import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { format, isValid } from "date-fns";
import { formatCurrency } from "@/lib/utils";
import { CheckCircle2 } from "lucide-react";

interface FinalTwoWeeksInfo {
  amount: number;
  isPaid: boolean;
  isPastDue: boolean;
  dueByWeek: number;
  dueByDate: Date | null;
}

interface PaymentSummaryCardsProps {
  totalWeeksInSeason: number;
  fullSeasonAmount: number;
  weeklyFee: number;
  weeksDueCount: number;
  totalSeasonDues: number;
  weeksPaid: number;
  totalPaidAmount: number;
  amountPastDue: number;
  remainingBalance: number;
  finalTwoWeeks: FinalTwoWeeksInfo;
  finalTwoWeeksPaidOnWeek: number | null;
  onPayPastDue: () => void;
  onPayRemaining: () => void;
}

export function PaymentSummaryCards({
  totalWeeksInSeason,
  fullSeasonAmount,
  weeklyFee,
  weeksDueCount,
  totalSeasonDues,
  weeksPaid,
  totalPaidAmount,
  amountPastDue,
  remainingBalance,
  finalTwoWeeks,
  finalTwoWeeksPaidOnWeek,
  onPayPastDue,
  onPayRemaining,
}: PaymentSummaryCardsProps) {
  const isPaidInFull = remainingBalance <= 0 && totalPaidAmount > 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {isPaidInFull && (
        <Card className="md:col-span-3 border-green-500/50 bg-green-500/5">
          <CardContent className="flex items-center justify-center gap-3 py-4">
            <CheckCircle2 className="h-6 w-6 text-green-600" />
            <span className="text-lg font-semibold text-green-600">Season Paid in Full</span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Full Season Amount Due</CardTitle>
          <CardDescription>
            {totalWeeksInSeason} week{totalWeeksInSeason === 1 ? "" : "s"} at {formatCurrency(weeklyFee)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{formatCurrency(fullSeasonAmount)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Weekly Fee</CardTitle>
          <CardDescription>Regular payment amount</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{formatCurrency(weeklyFee)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Amount Due to Date</CardTitle>
          <CardDescription>
            {weeksDueCount} week{weeksDueCount === 1 ? "" : "s"} at {formatCurrency(weeklyFee)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{formatCurrency(totalSeasonDues)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Amount Paid to Date</CardTitle>
          <CardDescription>
            {weeksPaid} week{weeksPaid === 1 ? "" : "s"} at {formatCurrency(weeklyFee)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{formatCurrency(totalPaidAmount)}</p>
        </CardContent>
      </Card>

      <Card
        className={amountPastDue > 0 ? "cursor-pointer transition-colors hover:border-destructive/50 hover:bg-destructive/5" : ""}
        onClick={() => amountPastDue > 0 && onPayPastDue()}
      >
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Amount Past Due to Date</CardTitle>
          <CardDescription>{amountPastDue > 0 ? "Click to make a payment" : "No amount past due"}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-destructive">{formatCurrency(amountPastDue)}</p>
        </CardContent>
      </Card>

      <Card
        className={remainingBalance > 0 ? "cursor-pointer transition-colors hover:border-primary/50 hover:bg-primary/5" : ""}
        onClick={() => remainingBalance > 0 && onPayRemaining()}
      >
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Full Season Remaining Balance</CardTitle>
          <CardDescription>{remainingBalance > 0 ? "Click to pay off balance" : "Fully paid"}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{formatCurrency(remainingBalance)}</p>
        </CardContent>
      </Card>

      {finalTwoWeeks.amount > 0 && (
        <Card className={`${
          finalTwoWeeks.isPaid
            ? 'border-green-500/50 bg-green-500/5'
            : finalTwoWeeks.isPastDue
              ? 'border-destructive/50 bg-destructive/5'
              : ''
        }`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Final 2 Weeks</CardTitle>
            <CardDescription>
              Due by Week {finalTwoWeeks.dueByWeek}
              {finalTwoWeeks.dueByDate && isValid(finalTwoWeeks.dueByDate) && ` (${format(finalTwoWeeks.dueByDate, 'MMM d, yyyy')})`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${
              finalTwoWeeks.isPaid
                ? 'text-green-600'
                : finalTwoWeeks.isPastDue
                  ? 'text-destructive'
                  : ''
            }`}>
              {formatCurrency(finalTwoWeeks.amount)}
            </p>
            <p className={`text-sm font-medium mt-1 ${
              finalTwoWeeks.isPaid
                ? 'text-green-600'
                : finalTwoWeeks.isPastDue
                  ? 'text-destructive'
                  : 'text-muted-foreground'
            }`}>
              {finalTwoWeeks.isPaid
                ? `Paid on Week ${finalTwoWeeksPaidOnWeek ?? '?'}`
                : finalTwoWeeks.isPastDue ? 'Past Due' : 'Due'}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
