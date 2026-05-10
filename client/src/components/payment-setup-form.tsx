import { FC, RefObject } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CalendarDays, Users } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { League, SavedCard } from "@shared/schema";
import { PaymentCustomAmount } from "@/components/payment-custom-amount";
import { PaymentSetupCardInput } from "@/components/payment-setup-card-input";
import { PaymentSubmitSection } from "@/components/payment-submit-section";

type RefDiv = React.RefObject<HTMLDivElement>;

type PaymentSchedule = "weekly" | "custom";

interface PaymentSetupFormProps {
  league: League;
  weeklyFee: number;
  totalWeeks: number;
  paymentMode: 'autopay' | 'onetime';
  selectedSchedule: PaymentSchedule;
  selectedWeeks: number;
  maxPayableWeeks: number;
  fixedAmount: number | null;
  fixedAmountType: 'remaining' | 'pastDue' | null;
  financials: {
    fullSeasonAmount: number;
    doublePay: { dates: string[]; perWeekExtra: number; totalExtra: number; pastExtra: number; isPaid: boolean };
    amountPastDue: number;
    remainingBalance: number;
    totalPaid: number;
  };
  seasonPresets: { label: string; weeks: number }[];
  savedCards: SavedCard[];
  cardMode: 'new' | 'saved';
  selectedSavedCardId: string;
  cardContainerRef: RefObject<HTMLDivElement>;
  isInitialized: boolean;
  squareError: string | null;
  storeCard: boolean;
  isSubmitting: boolean;
  onWeekChange: (weeks: number) => void;
  onFixedAmount: (amount: number | null, type: 'remaining' | 'pastDue' | null) => void;
  setCardMode: (mode: 'new' | 'saved') => void;
  setSelectedSavedCardId: (id: string) => void;
  setStoreCard: (val: boolean) => void;
  cleanupCard: () => void;
  calculateTotalAmount: () => number;
  onSubmit: () => void;
  onCancel: () => void;
  applePayAvailable: boolean;
  googlePayAvailable: boolean;
  applePayRef: RefDiv;
  googlePayRef: RefDiv;
  onApplePayClick: () => void;
  onGooglePayClick: () => void;
  isWalletProcessing: boolean;
  applePayTokenizeOnly: boolean;
  googlePayTokenizeOnly: boolean;
  // recipient picker. When the logged-in
  // bowler has accepted-link partners, render a "Pay for" select.
  // Locked to self when the form is in autopay mode (autopay charges
  // the schedule's owner each week, partner autopay isn't supported).
  partnerOptions?: { id: number; name: string }[];
  selfBowler: { id: number; name: string };
  targetBowlerId: number;
  setTargetBowlerId: (id: number) => void;
  allowPartnerSelection: boolean;
  // combined-autopay target multi-select. When
  // the bowler is setting up autopay AND has accepted partners, we
  // render a checkbox group that lets them have ONE schedule charge
  // their card weekly for themselves PLUS each selected partner. The
  // `additionalBowlerIds` array is forwarded to POST /api/payment-
  // schedules' `additionalBowlerIds` field, which the autopay executor
  // walks each cycle to charge the payer's vault for each partner. The
  // payer is always the schedule owner (selfBowler); partners are
  // charged BUT credited as their own payment row stamped with
  // `paidByUserId`.
  additionalBowlerIds: number[];
  setAdditionalBowlerIds: (ids: number[]) => void;
  // Task #715: per-partner past-due (cents) for the current league.
  // When weekly auto-pay is being set up and any included bowler has
  // a past-due balance, the immediate charge is Σ(pastDue+weeklyFee)
  // per included bowler — surfaced here as a "Total due today" line.
  partnerPastDueByBowlerId?: Record<number, number>;
}

export const PaymentSetupForm: FC<PaymentSetupFormProps> = ({
  league,
  weeklyFee,
  totalWeeks,
  paymentMode,
  selectedSchedule,
  selectedWeeks,
  maxPayableWeeks,
  fixedAmount,
  fixedAmountType,
  financials,
  seasonPresets,
  savedCards,
  cardMode,
  selectedSavedCardId,
  cardContainerRef,
  isInitialized,
  squareError,
  storeCard,
  isSubmitting,
  onWeekChange,
  onFixedAmount,
  setCardMode,
  setSelectedSavedCardId,
  setStoreCard,
  cleanupCard,
  calculateTotalAmount,
  onSubmit,
  onCancel,
  applePayAvailable,
  googlePayAvailable,
  applePayRef,
  googlePayRef,
  onApplePayClick,
  onGooglePayClick,
  isWalletProcessing,
  applePayTokenizeOnly,
  googlePayTokenizeOnly,
  partnerOptions = [],
  selfBowler,
  targetBowlerId,
  setTargetBowlerId,
  allowPartnerSelection,
  additionalBowlerIds,
  setAdditionalBowlerIds,
  partnerPastDueByBowlerId = {},
}) => {
  // Task #706: combined-pay (multi-select) is now offered for ALL
  // payment modes — autopay, one-time, and upfront — whenever the
  // bowler has accepted partners. Picking at least one partner here
  // bundles the payment into ONE card transaction with N+1 per-bowler
  // rows (server-side endpoint `/api/payments-provider/combined-
  // payments` for one-time/upfront, or the autopay schedule's
  // `additionalBowlerIds` for weekly/custom autopay).
  const hasCombinedPicks = additionalBowlerIds.length > 0;
  // The single-recipient picker only makes sense when NO combined-pay
  // partners are selected (combined-pay is always self+partners).
  const showPartnerPicker =
    allowPartnerSelection && partnerOptions.length > 0 && !hasCombinedPicks;
  const showCombinedPay = partnerOptions.length > 0;
  const baseAmount = calculateTotalAmount();
  const combinedTotal = baseAmount * (1 + additionalBowlerIds.length);

  // Task #715: weekly auto-pay setup must clear past-due up front. When
  // any included bowler has a past-due balance, the immediate charge is
  // Σ(amountPastDue + weeklyFee) for the payer + each combined partner.
  // The recurring weekly amount is unchanged.
  const isAutopayMode = paymentMode === 'autopay' && league.paymentMode !== 'upfront';
  const selfPastDue = financials.amountPastDue;
  const partnerPastDueSum = additionalBowlerIds.reduce(
    (sum, id) => sum + (partnerPastDueByBowlerId[id] ?? 0),
    0,
  );
  const anyAutopayPastDue =
    isAutopayMode &&
    (selfPastDue > 0 ||
      additionalBowlerIds.some((id) => (partnerPastDueByBowlerId[id] ?? 0) > 0));
  const autopayDueTodayTotal = isAutopayMode
    ? selfPastDue + weeklyFee * (1 + additionalBowlerIds.length) + partnerPastDueSum
    : 0;
  const selfDueToday = selfPastDue + weeklyFee;
  const partnerDueToday = (id: number) => (partnerPastDueByBowlerId[id] ?? 0) + weeklyFee;
  const togglePartner = (id: number, on: boolean) => {
    if (on) {
      if (!additionalBowlerIds.includes(id)) {
        setAdditionalBowlerIds([...additionalBowlerIds, id]);
      }
    } else {
      setAdditionalBowlerIds(additionalBowlerIds.filter((x) => x !== id));
    }
  };
  return (
    <Card className="w-full">
      <CardHeader className={league.paymentMode !== 'upfront' && paymentMode === 'autopay' ? 'pb-4' : undefined}>
        <CardTitle>
          {league.paymentMode === 'upfront' ? 'Full Season Payment' : paymentMode === 'onetime' ? 'Make One-Time Payment' : 'Set Up Automatic Payments'}
        </CardTitle>
        {(league.paymentMode === 'upfront' || paymentMode === 'onetime') && (
          <CardDescription>
            {league.paymentMode === 'upfront' ? 'Your full season dues will be charged in a single payment' : 'Enter your card to make a payment'}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {showPartnerPicker && (
            <div className="space-y-2" data-testid="recipient-picker">
              <Label className="flex items-center gap-2 text-sm font-medium">
                <Users className="h-4 w-4 text-muted-foreground" /> Pay for
              </Label>
              <Select
                value={String(targetBowlerId)}
                onValueChange={(v) => setTargetBowlerId(Number(v))}
              >
                <SelectTrigger data-testid="select-recipient">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    value={String(selfBowler.id)}
                    data-testid={`recipient-option-${selfBowler.id}`}
                  >
                    {selfBowler.name} (you)
                  </SelectItem>
                  {partnerOptions.map((p) => (
                    <SelectItem
                      key={p.id}
                      value={String(p.id)}
                      data-testid={`recipient-option-${p.id}`}
                    >
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {targetBowlerId !== selfBowler.id && (
                <p className="text-xs text-muted-foreground">
                  This payment will be recorded against your linked partner and
                  attributed as paid by you.
                </p>
              )}
            </div>
          )}
          {league.paymentMode === 'upfront' ? (
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
                  {formatCurrency(financials.fullSeasonAmount * (1 + additionalBowlerIds.length))}
                </span>
              </div>
            </div>
          ) : paymentMode === 'autopay' && (
            <div className="rounded-md border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center gap-3">
                <CalendarDays className="h-5 w-5 text-muted-foreground shrink-0" />
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
          )}

          {showCombinedPay && (
            <div
              className="space-y-2 rounded-md border bg-muted/20 p-4"
              data-testid="combined-autopay-group"
            >
              <Label className="flex items-center gap-2 text-sm font-medium">
                <Users className="h-4 w-4 text-muted-foreground" />
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
          )}
          
          {selectedSchedule === 'custom' && league.paymentMode !== 'upfront' && (
            <PaymentCustomAmount
              weeklyFee={weeklyFee}
              totalWeeks={totalWeeks}
              selectedWeeks={selectedWeeks}
              maxPayableWeeks={maxPayableWeeks}
              fixedAmount={fixedAmount}
              fixedAmountType={fixedAmountType}
              financials={financials}
              seasonPresets={seasonPresets}
              onWeekChange={onWeekChange}
              onFixedAmount={onFixedAmount}
            />
          )}

          <PaymentSetupCardInput
            savedCards={savedCards}
            cardMode={cardMode}
            setCardMode={setCardMode}
            selectedSavedCardId={selectedSavedCardId}
            setSelectedSavedCardId={setSelectedSavedCardId}
            cardContainerRef={cardContainerRef}
            isInitialized={isInitialized}
            squareError={squareError}
            storeCard={storeCard}
            setStoreCard={setStoreCard}
            showStoreCardOption={league.paymentMode === 'upfront' || selectedSchedule === 'custom'}
            cleanupCard={cleanupCard}
            applePayAvailable={applePayAvailable}
            googlePayAvailable={googlePayAvailable}
            applePayRef={applePayRef}
            googlePayRef={googlePayRef}
            onApplePayClick={onApplePayClick}
            onGooglePayClick={onGooglePayClick}
            isWalletProcessing={isWalletProcessing}
            applePayTokenizeOnly={applePayTokenizeOnly}
            googlePayTokenizeOnly={googlePayTokenizeOnly}
          />

          <PaymentSubmitSection
            league={league}
            selectedSchedule={selectedSchedule}
            fixedAmountType={fixedAmountType}
            selectedWeeks={selectedWeeks}
            calculateTotalAmount={calculateTotalAmount}
            isSubmitting={isSubmitting}
            cardMode={cardMode}
            isInitialized={isInitialized}
            selectedSavedCardId={selectedSavedCardId}
            fullSeasonAmount={financials.fullSeasonAmount}
            additionalBowlerCount={additionalBowlerIds.length}
            autopayDueTodayOverride={anyAutopayPastDue ? autopayDueTodayTotal : null}
            onSubmit={onSubmit}
            onCancel={onCancel}
          />
        </div>
      </CardContent>
    </Card>
  );
};
