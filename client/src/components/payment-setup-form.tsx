import { FC, RefObject } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CalendarDays } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
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
  includeFinalTwoWeeks: boolean;
  showFinalTwoWeeksWarning: boolean;
  financials: {
    fullSeasonAmount: number;
    finalTwoWeeks: { amount: number; dueByWeek: number; isPaid: boolean };
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
  onIncludeFinalTwoWeeksChange: (val: boolean) => void;
  setCardMode: (mode: 'new' | 'saved') => void;
  setSelectedSavedCardId: (id: string) => void;
  setStoreCard: (val: boolean) => void;
  cleanupCard: () => void;
  calculateTotalAmount: () => number;
  onSubmit: () => void;
  onCancel: () => void;
  onAddFinalTwoWeeks: () => void;
  applePayAvailable: boolean;
  googlePayAvailable: boolean;
  applePayRef: RefDiv;
  googlePayRef: RefDiv;
  onApplePayClick: () => void;
  onGooglePayClick: () => void;
  isWalletProcessing: boolean;
  applePayTokenizeOnly: boolean;
  googlePayTokenizeOnly: boolean;
  onDeleteCard?: (cardId: string) => void;
  isDeletingCard?: boolean;
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
  includeFinalTwoWeeks,
  showFinalTwoWeeksWarning,
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
  onIncludeFinalTwoWeeksChange,
  setCardMode,
  setSelectedSavedCardId,
  setStoreCard,
  cleanupCard,
  calculateTotalAmount,
  onSubmit,
  onCancel,
  onAddFinalTwoWeeks,
  applePayAvailable,
  googlePayAvailable,
  applePayRef,
  googlePayRef,
  onApplePayClick,
  onGooglePayClick,
  isWalletProcessing,
  applePayTokenizeOnly,
  googlePayTokenizeOnly,
  onDeleteCard,
  isDeletingCard,
}) => {
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
                <span className="text-lg font-bold">{formatCurrency(financials.fullSeasonAmount)}</span>
              </div>
            </div>
          ) : paymentMode === 'autopay' && (
            <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-4">
              <CalendarDays className="h-5 w-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">Weekly auto-pay</p>
                <p className="text-sm text-muted-foreground">{formatCurrency(weeklyFee)} charged each league night</p>
              </div>
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
              includeFinalTwoWeeks={includeFinalTwoWeeks}
              seasonPresets={seasonPresets}
              onWeekChange={onWeekChange}
              onFixedAmount={onFixedAmount}
              onIncludeFinalTwoWeeksChange={onIncludeFinalTwoWeeksChange}
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
            showStoreCardOption={selectedSchedule === 'custom'}
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
            onDeleteCard={onDeleteCard}
            isDeletingCard={isDeletingCard}
          />

          <PaymentSubmitSection
            league={league}
            selectedSchedule={selectedSchedule}
            fixedAmountType={fixedAmountType}
            selectedWeeks={selectedWeeks}
            includeFinalTwoWeeks={includeFinalTwoWeeks}
            finalTwoWeeksAmount={financials.finalTwoWeeks.amount}
            calculateTotalAmount={calculateTotalAmount}
            showFinalTwoWeeksWarning={showFinalTwoWeeksWarning}
            finalTwoWeeksDueByWeek={financials.finalTwoWeeks.dueByWeek}
            isSubmitting={isSubmitting}
            cardMode={cardMode}
            isInitialized={isInitialized}
            selectedSavedCardId={selectedSavedCardId}
            fullSeasonAmount={financials.fullSeasonAmount}
            onSubmit={onSubmit}
            onCancel={onCancel}
            onAddFinalTwoWeeks={onAddFinalTwoWeeks}
          />
        </div>
      </CardContent>
    </Card>
  );
};
