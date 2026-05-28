import { FC } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Plus, Minus } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

interface FinancialSummary {
  amountPastDue: number;
  remainingBalance: number;
}

interface PaymentCustomAmountProps {
  weeklyFee: number;
  totalWeeks: number;
  selectedWeeks: number;
  maxPayableWeeks: number;
  fixedAmount: number | null;
  fixedAmountType: 'remaining' | 'pastDue' | null;
  financials: FinancialSummary;
  seasonPresets: { label: string; weeks: number }[];
  onWeekChange: (weeks: number) => void;
  onFixedAmount: (amount: number | null, type: 'remaining' | 'pastDue' | null) => void;
}

export const PaymentCustomAmount: FC<PaymentCustomAmountProps> = ({
  weeklyFee,
  totalWeeks: _totalWeeks,
  selectedWeeks,
  maxPayableWeeks,
  fixedAmount,
  fixedAmountType,
  financials,
  seasonPresets,
  onWeekChange,
  onFixedAmount,
}) => {
  return (
    <div className="space-y-4 p-4 rounded-md border bg-background">
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <Label htmlFor="custom-weeks">Number of Weeks</Label>
          <span className="text-sm font-medium">
            {formatCurrency(fixedAmount !== null ? fixedAmount : weeklyFee * selectedWeeks)} total
          </span>
        </div>
        <div className="flex items-center gap-x-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => onWeekChange(selectedWeeks - 1)}
            disabled={selectedWeeks <= 1}
          >
            <Minus className="size-4" />
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
            <Plus className="size-4" />
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
  );
};
