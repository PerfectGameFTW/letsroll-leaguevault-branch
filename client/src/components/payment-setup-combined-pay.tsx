import { FC } from "react";
import { Users } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency } from "@/lib/utils";

interface PaymentSetupCombinedPayProps {
  league: { paymentMode: string | null };
  paymentMode: 'autopay' | 'onetime';
  selfBowler: { id: number; name: string };
  partnerOptions: { id: number; name: string }[];
  additionalBowlerIds: number[];
  togglePartner: (id: number, on: boolean) => void;
  isAutopayMode: boolean;
  anyAutopayPastDue: boolean;
  selfDueToday: number;
  partnerDueToday: (id: number) => number;
  baseAmount: number;
  combinedTotal: number;
  autopayDueTodayTotal: number;
}

export const PaymentSetupCombinedPay: FC<PaymentSetupCombinedPayProps> = ({
  league,
  paymentMode,
  selfBowler,
  partnerOptions,
  additionalBowlerIds,
  togglePartner,
  isAutopayMode,
  anyAutopayPastDue,
  selfDueToday,
  partnerDueToday,
  baseAmount,
  combinedTotal,
  autopayDueTodayTotal,
}) => {
  return (
    <div
      className="space-y-2 rounded-md border bg-muted/20 p-4"
      data-testid="combined-autopay-group"
    >
      <Label className="flex items-center gap-2 text-sm font-medium">
        <Users className="size-4 text-muted-foreground" />
        {paymentMode === 'autopay' && league.paymentMode !== 'upfront'
          ? 'Also charge me for these linked bowlers each week'
          : 'Also pay for these linked bowlers in this transaction'}
      </Label>
      <p className="text-xs text-muted-foreground">
        {paymentMode === 'autopay' && league.paymentMode !== 'upfront'
          ? "Your card will be charged for everyone you select on the same schedule. Each charge is recorded against the partner's account and attributed as paid by you."
          : "Your card will be charged once for everyone you select. Each amount is recorded against the partner's account and attributed as paid by you."}
      </p>
      <div className="space-y-2 pt-1">
        <label
          className="flex items-center justify-between gap-2 text-sm opacity-80"
          data-testid={`combined-pay-option-self-${selfBowler.id}`}
        >
          <span className="flex items-center gap-2">
            <Checkbox checked disabled />
            <span>{selfBowler.name} (you)</span>
          </span>
          <span className="text-muted-foreground">
            {formatCurrency(isAutopayMode && anyAutopayPastDue ? selfDueToday : baseAmount)}
          </span>
        </label>
        {partnerOptions.map((p) => {
          const checked = additionalBowlerIds.includes(p.id);
          const rowAmount =
            isAutopayMode && anyAutopayPastDue ? partnerDueToday(p.id) : baseAmount;
          return (
            <label
              key={p.id}
              className="flex items-center justify-between gap-2 text-sm"
              data-testid={`combined-autopay-option-${p.id}`}
            >
              <span className="flex items-center gap-2">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => togglePartner(p.id, v === true)}
                  data-testid={`combined-autopay-checkbox-${p.id}`}
                />
                <span>{p.name}</span>
              </span>
              <span className="text-muted-foreground">{formatCurrency(rowAmount)}</span>
            </label>
          );
        })}
      </div>
      {additionalBowlerIds.length > 0 && (
        <div className="border-t pt-3 flex items-center justify-between">
          <span className="text-sm font-semibold">
            {isAutopayMode && anyAutopayPastDue
              ? 'Total due today'
              : isAutopayMode
                ? 'Combined per-cycle total'
                : 'Combined total'}
          </span>
          <span
            className="text-base font-bold"
            data-testid="combined-pay-total"
          >
            {formatCurrency(
              isAutopayMode && anyAutopayPastDue ? autopayDueTodayTotal : combinedTotal,
            )}
          </span>
        </div>
      )}
    </div>
  );
};
