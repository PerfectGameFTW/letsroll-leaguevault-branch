import { FC } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface PaymentSubmitSectionProps {
  league: { paymentMode: string | null };
  selectedSchedule: string;
  fixedAmountType: 'remaining' | 'pastDue' | null;
  selectedWeeks: number;
  includeFinalTwoWeeks: boolean;
  finalTwoWeeksAmount: number;
  calculateTotalAmount: () => number;
  showFinalTwoWeeksWarning: boolean;
  finalTwoWeeksDueByWeek: number;
  isSubmitting: boolean;
  cardMode: 'new' | 'saved';
  isInitialized: boolean;
  selectedSavedCardId: string;
  fullSeasonAmount: number;
  onSubmit: () => void;
  onCancel: () => void;
  onAddFinalTwoWeeks: () => void;
}

export const PaymentSubmitSection: FC<PaymentSubmitSectionProps> = ({
  league,
  selectedSchedule,
  fixedAmountType,
  selectedWeeks,
  includeFinalTwoWeeks,
  finalTwoWeeksAmount,
  calculateTotalAmount,
  showFinalTwoWeeksWarning,
  finalTwoWeeksDueByWeek,
  isSubmitting,
  cardMode,
  isInitialized,
  selectedSavedCardId,
  fullSeasonAmount,
  onSubmit,
  onCancel,
  onAddFinalTwoWeeks,
}) => {
  return (
    <>
      {league.paymentMode !== 'upfront' && (
        <div className="pt-4 border-t">
          <div className="flex justify-between items-center">
            <span className="text-lg font-medium">Total Amount</span>
            <span className="text-lg font-bold">{formatCurrency(calculateTotalAmount())}</span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {selectedSchedule === 'weekly' && 'Charged weekly'}
            {selectedSchedule === 'custom' && (
              fixedAmountType === 'pastDue'
                ? 'One-time payment for Past Due Balance'
                : fixedAmountType === 'remaining'
                  ? 'One-time payment for Season Remaining Balance'
                  : `One-time payment for ${selectedWeeks} weeks`
            )}
            {includeFinalTwoWeeks && ` + Final 2 Weeks (${formatCurrency(finalTwoWeeksAmount)})`}
          </p>
        </div>
      )}
      
      {league.paymentMode !== 'upfront' && showFinalTwoWeeksWarning && (
        <div className="rounded-md border border-yellow-500/50 bg-yellow-50 dark:bg-yellow-950/20 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                Final 2 Weeks Not Included
              </p>
              <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                You haven't included the Final 2 Weeks payment ({formatCurrency(finalTwoWeeksAmount)}) due by Week {finalTwoWeeksDueByWeek}. 
                If not paid now, it will be automatically charged to your card on the week it's due.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onAddFinalTwoWeeks}
            >
              Add Final 2 Weeks Now
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={onSubmit}
              disabled={isSubmitting}
            >
              Continue Without
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:justify-between gap-2">
        <Button 
          variant="outline"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button 
          onClick={onSubmit}
          disabled={
            (cardMode === 'new' && !isInitialized) ||
            (cardMode === 'saved' && !selectedSavedCardId) ||
            isSubmitting
          }
          className="min-w-[200px]"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : league.paymentMode === 'upfront' ? (
            `Pay ${formatCurrency(fullSeasonAmount)}`
          ) : (
            <>{selectedSchedule === 'custom' ? 'Make One-Time Payment' : 'Set Up Automatic Payments'}</>
          )}
        </Button>
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground pt-2">
        <div className="flex-1 border-t" />
        <span>Secure payment powered by Square</span>
        <div className="flex-1 border-t" />
      </div>
    </>
  );
};
