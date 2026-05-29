import { FC } from "react";
import { CalendarDays } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface PaymentSetupSummaryCardProps {
  league: { paymentMode: string | null };
  paymentMode: 'autopay' | 'onetime';
  weeklyFee: number;
  totalWeeks: number;
  fullSeasonAmount: number;
  additionalBowlerCount: number;
  anyAutopayPastDue: boolean;
  autopayDueTodayTotal: number;
}

export const PaymentSetupSummaryCard: FC<PaymentSetupSummaryCardProps> = ({
  league,
  paymentMode,
  weeklyFee,
  totalWeeks,
  fullSeasonAmount,
  additionalBowlerCount,
  anyAutopayPastDue,
  autopayDueTodayTotal,
}) => {
  if (league.paymentMode === 'upfront') {
    return (
      <div className="rounded-md border bg-muted/30 p-4 space-y-2">
        <div className="flex items-center justify-between py-1">
          <span className="text-sm text-muted-foreground">Weekly fee</span>
          <span className="text-sm">{formatCurrency(weeklyFee)} / week</span>
        </div>
        <div className="flex items-center justify-between py-1">
          <span className="text-sm text-muted-foreground">Season length</span>
          <span className="text-sm">{totalWeeks} weeks</span>
        </div>
        <div className="border-t pt-3 flex items-center justify-between">
          <span className="font-semibold">Total due today</span>
          <span className="text-lg font-bold" data-testid="upfront-total-due">
            {formatCurrency(fullSeasonAmount * (1 + additionalBowlerCount))}
          </span>
        </div>
      </div>
    );
  }
  if (paymentMode === 'autopay') {
    return (
      <div className="rounded-md border bg-muted/30 p-4 space-y-3">
        <div className="flex items-center gap-3">
          <CalendarDays className="size-5 text-muted-foreground shrink-0" />
          <div>
            <p className="text-sm font-medium">Weekly auto-pay</p>
            <p className="text-sm text-muted-foreground">{formatCurrency(weeklyFee)} charged each league night</p>
          </div>
        </div>
        {anyAutopayPastDue && (
          <div className="border-t pt-3 flex items-center justify-between">
            <span className="text-sm font-semibold">Total due today</span>
            <span
              className="text-base font-bold"
              data-testid="autopay-due-today"
            >
              {formatCurrency(autopayDueTodayTotal)}
            </span>
          </div>
        )}
      </div>
    );
  }
  return null;
};
