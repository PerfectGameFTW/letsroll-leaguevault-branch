import { FC, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Plus, Minus } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface FinancialSummary {
  amountPastDue: number;
  remainingBalance: number;
  finalTwoWeeks: {
    isPaid: boolean;
    amount: number;
    dueByWeek: number;
  };
}

interface PaymentCustomAmountProps {
  weeklyFee: number;
  totalWeeks: number;
  selectedWeeks: number;
  maxPayableWeeks: number;
  fixedAmount: number | null;
  fixedAmountType: 'remaining' | 'pastDue' | null;
  financials: FinancialSummary;
  includeFinalTwoWeeks: boolean;
  seasonPresets: { label: string; weeks: number }[];
  onWeekChange: (weeks: number) => void;
  onFixedAmount: (amount: number | null, type: 'remaining' | 'pastDue' | null) => void;
  onIncludeFinalTwoWeeksChange: (v: boolean) => void;
}

export const PaymentCustomAmount: FC<PaymentCustomAmountProps> = ({
  weeklyFee,
  totalWeeks,
  selectedWeeks,
  maxPayableWeeks,
  fixedAmount,
  fixedAmountType,
  financials,
  includeFinalTwoWeeks,
  seasonPresets,
  onWeekChange,
  onFixedAmount,
  onIncludeFinalTwoWeeksChange,
}) => {
  return (
    <>
      <div className="space-y-4 p-4 rounded-md border bg-background">
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <Label htmlFor="custom-weeks">Number of Weeks</Label>
            <span className="text-sm font-medium">
              {formatCurrency(fixedAmount !== null ? fixedAmount : weeklyFee * selectedWeeks)} total
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => onWeekChange(selectedWeeks - 1)}
              disabled={selectedWeeks <= 1}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <input
              id="custom-weeks"
              type="number"
              min="1"
              max={maxPayableWeeks}
              value={selectedWeeks}
              onChange={(e) => onWeekChange(parseInt(e.target.value, 10))}
              className="flex h-10 w-16 rounded-md border border-input bg-background px-3 py-2 text-sm text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => onWeekChange(selectedWeeks + 1)}
              disabled={selectedWeeks >= maxPayableWeeks}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
        
        <div>
          <Label className="text-sm text-muted-foreground mb-2 block">
            Quick Select
          </Label>
          <div className="flex flex-wrap gap-2">
            {seasonPresets.map((preset) => (
              <Button
                key={preset.label}
                variant={fixedAmount === null && selectedWeeks === preset.weeks ? "default" : "outline"}
                size="sm"
                onClick={() => onWeekChange(preset.weeks)}
              >
                {preset.label}
              </Button>
            ))}
            {financials.amountPastDue > 0 && (
              <Button
                variant={fixedAmountType === 'pastDue' ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  onFixedAmount(financials.amountPastDue, 'pastDue');
                }}
              >
                Past Due Balance
              </Button>
            )}
            {financials.remainingBalance > 0 && (
              <Button
                variant={fixedAmountType === 'remaining' ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  onFixedAmount(financials.remainingBalance, 'remaining');
                }}
              >
                Season Remaining Balance
              </Button>
            )}
          </div>
        </div>
      </div>

      {!financials.finalTwoWeeks.isPaid && financials.finalTwoWeeks.amount > 0 && fixedAmountType !== 'remaining' && fixedAmountType !== 'pastDue' && !(fixedAmount === null && selectedWeeks === totalWeeks) && (
        <div className="flex items-start space-x-3 rounded-md border p-4 bg-muted/50">
          <Checkbox
            id="include-final-two-weeks"
            checked={includeFinalTwoWeeks}
            onCheckedChange={(checked) => onIncludeFinalTwoWeeksChange(checked === true)}
          />
          <div className="space-y-1">
            <Label htmlFor="include-final-two-weeks" className="text-sm font-medium cursor-pointer">
              Add Final 2 Weeks ({formatCurrency(financials.finalTwoWeeks.amount)})
            </Label>
            <p className="text-xs text-muted-foreground">
              Add the final 2 weeks payment to this transaction. Due by Week {financials.finalTwoWeeks.dueByWeek}.
            </p>
          </div>
        </div>
      )}
    </>
  );
};
