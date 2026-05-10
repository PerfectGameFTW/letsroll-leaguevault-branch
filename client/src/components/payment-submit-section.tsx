import { FC } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface PaymentSubmitSectionProps {
  league: { paymentMode: string | null };
  selectedSchedule: string;
  fixedAmountType: 'remaining' | 'pastDue' | null;
  selectedWeeks: number;
  calculateTotalAmount: () => number;
  isSubmitting: boolean;
  cardMode: 'new' | 'saved';
  isInitialized: boolean;
  selectedSavedCardId: string;
  fullSeasonAmount: number;
  additionalBowlerCount?: number;
  onSubmit: () => void;
  onCancel: () => void;
}

export const PaymentSubmitSection: FC<PaymentSubmitSectionProps> = ({
  league,
  selectedSchedule,
  fixedAmountType,
  selectedWeeks,
  calculateTotalAmount,
  isSubmitting,
  cardMode,
  isInitialized,
  selectedSavedCardId,
  fullSeasonAmount,
  additionalBowlerCount = 0,
  onSubmit,
  onCancel,
}) => {
  const multiplier = 1 + additionalBowlerCount;
  return (
    <>
      {league.paymentMode !== 'upfront' && (
        <div className="pt-4 border-t">
          <div className="flex justify-between items-center">
            <span className="text-lg font-medium">Total Amount</span>
            <span className="text-lg font-bold">{formatCurrency(calculateTotalAmount() * multiplier)}</span>
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
          </p>
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
            `Pay ${formatCurrency(fullSeasonAmount * multiplier)}`
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
