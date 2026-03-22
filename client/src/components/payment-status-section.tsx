import { FC, useRef, useEffect, useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CalendarDays } from "lucide-react";
import { useSquarePayment } from "@/hooks/use-square-payment";
import { createPayment, tokenizeCard } from "@/lib/square";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, csrfFetch } from '@/lib/queryClient';
import { formatCurrency } from "@/lib/utils";
import { calculateFinancials } from "@/lib/financial-utils";
import type { League, Bowler, Payment, SavedCard } from "@shared/schema";
import { PaymentOverviewCard } from "@/components/payment-overview-card";
import { PaymentSetupCardInput } from "@/components/payment-setup-card-input";
import { PaymentCustomAmount } from "@/components/payment-custom-amount";
import { PaymentSubmitSection } from "@/components/payment-submit-section";

type PaymentSchedule = "weekly" | "custom";

interface ScheduleData {
  id: number;
  frequency: string;
  nextPaymentDate: string;
  amount: number;
  active: boolean;
  leagueTimezone?: string;
}

interface PaymentStatusSectionProps {
  league: League;
  bowler: Bowler;
  weeklyFee: number;
  totalWeeks: number;
  payments: Payment[];
}

export const PaymentStatusSection: FC<PaymentStatusSectionProps> = ({
  league,
  bowler,
  weeklyFee,
  totalWeeks,
  payments,
}) => {
  const { toast } = useToast();
  const cardContainerRef = useRef<HTMLDivElement>(null);
  const [showPaymentSetup, setShowPaymentSetup] = useState(false);
  const [paymentMode, setPaymentMode] = useState<'autopay' | 'onetime'>('autopay');
  const [selectedSchedule, setSelectedSchedule] = useState<PaymentSchedule>("weekly");
  const [storeCard, setStoreCard] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedWeeks, setSelectedWeeks] = useState<number>(1);
  const [fixedAmount, setFixedAmount] = useState<number | null>(null);
  const [fixedAmountType, setFixedAmountType] = useState<'remaining' | 'pastDue' | null>(null);
  const [includeFinalTwoWeeks, setIncludeFinalTwoWeeks] = useState(false);
  const [showFinalTwoWeeksWarning, setShowFinalTwoWeeksWarning] = useState(false);
  const [cardMode, setCardMode] = useState<'new' | 'saved'>('new');
  const [selectedSavedCardId, setSelectedSavedCardId] = useState<string>('');

  const { card, isInitialized, error: squareError, initializeCard, cleanupCard } = useSquarePayment({
    locationId: league.locationId ?? null,
    onError: (error) => {
      console.error('[Square Payment Error]:', error);
      toast({
        title: "Payment Setup Error",
        description: error,
        variant: "destructive",
      });
    }
  });

  const { data: savedCardsResponse } = useQuery<{ success: boolean; data: SavedCard[] }>({
    queryKey: [`/api/square/cards/${bowler.id}`, league.id],
    queryFn: async () => {
      const res = await csrfFetch(`/api/square/cards/${bowler.id}?leagueId=${league.id}`);
      if (!res.ok) throw new Error('Failed to fetch saved cards');
      return res.json();
    },
    enabled: !!bowler.id,
    staleTime: 1000 * 60 * 5,
    retry: false,
  });
  const savedCards = savedCardsResponse?.data || [];

  useEffect(() => {
    if (savedCards.length > 0) {
      setCardMode('saved');
      setSelectedSavedCardId(savedCards[0].id);
    }
  }, [savedCards.length]);

  useEffect(() => {
    if (showPaymentSetup && cardContainerRef.current && cardMode === 'new') {
      initializeCard(cardContainerRef.current);
    }
  }, [showPaymentSetup, cardContainerRef, initializeCard, cardMode]);

  useEffect(() => {
    if (!showPaymentSetup) {
      cleanupCard();
    }
  }, [showPaymentSetup, cleanupCard]);

  const bowlerPayments = useMemo(() => {
    return (payments || []).filter(p => p.bowlerId === bowler.id && p.leagueId === league.id);
  }, [payments, bowler.id, league.id]);

  const financials = useMemo(() => {
    return calculateFinancials(league, bowlerPayments);
  }, [league, bowlerPayments]);

  const maxPayableWeeks = useMemo(() => {
    return Math.max(1, Math.floor(financials.remainingBalance / weeklyFee));
  }, [financials.remainingBalance, weeklyFee]);

  const handleWeekChangeWrapper = useCallback((weeks: number) => {
    const validWeeks = Math.min(Math.max(1, weeks), maxPayableWeeks);
    setSelectedWeeks(validWeeks);
    setFixedAmount(null);
    setFixedAmountType(null);
    if (validWeeks === maxPayableWeeks) {
      setIncludeFinalTwoWeeks(false);
    }
  }, [maxPayableWeeks]);

  const calculateTotalAmount = useCallback(() => {
    let base = 0;
    if (selectedSchedule === 'custom') {
      base = fixedAmount !== null ? fixedAmount : weeklyFee * selectedWeeks;
    } else {
      base = weeklyFee;
    }
    if (includeFinalTwoWeeks) {
      base += weeklyFee * 2;
    }
    return base;
  }, [selectedSchedule, weeklyFee, selectedWeeks, fixedAmount, includeFinalTwoWeeks]);

  const handleSubmitPayment = async () => {
    if (cardMode === 'new' && !card) {
      toast({ title: "Payment Setup Error", description: "Please enter your card details before proceeding.", variant: "destructive" });
      return;
    }
    if (cardMode === 'saved' && !selectedSavedCardId) {
      toast({ title: "Payment Setup Error", description: "Please select a saved card.", variant: "destructive" });
      return;
    }

    const isUpfront = league.paymentMode === 'upfront';
    const isAutoPay = !isUpfront && selectedSchedule !== 'custom';
    const finalTwoWeeksUnpaid = !financials.finalTwoWeeks.isPaid && financials.finalTwoWeeks.amount > 0;

    if (!isUpfront && isAutoPay && finalTwoWeeksUnpaid && !includeFinalTwoWeeks && !showFinalTwoWeeksWarning) {
      setShowFinalTwoWeeksWarning(true);
      return;
    }

    try {
      setIsSubmitting(true);
      setShowFinalTwoWeeksWarning(false);

      if (isUpfront) {
        const upfrontAmount = financials.fullSeasonAmount;
        let squareCardId: string;

        if (cardMode === 'saved' && selectedSavedCardId) {
          squareCardId = selectedSavedCardId;
        } else {
          const token = await tokenizeCard(card);
          const saveResponse = await csrfFetch(`/api/square/cards/${bowler.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourceId: token }),
          });
          const saveData = await saveResponse.json();
          if (!saveResponse.ok || !saveData.data?.savedCardId) {
            throw new Error(saveData.error?.message || 'Your card could not be saved. Please try again.');
          }
          squareCardId = saveData.data.savedCardId;
          queryClient.invalidateQueries({ queryKey: [`/api/square/cards/${bowler.id}`] });
        }

        const scheduleResponse = await csrfFetch('/api/payment-schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bowlerId: bowler.id,
            leagueId: league.id,
            frequency: 'upfront',
            amount: upfrontAmount,
            nextPaymentDate: new Date(),
            squareCardId,
            includeFinalTwoWeeks: false,
          }),
        });
        if (!scheduleResponse.ok) {
          const scheduleData = await scheduleResponse.json();
          throw new Error(scheduleData.error?.message || 'Failed to set up payment schedule');
        }
        queryClient.invalidateQueries({ queryKey: [`/api/payment-schedules/${bowler.id}/${league.id}`] });
        toast({
          title: "Payment Scheduled",
          description: "Your card has been saved and your full season payment will be processed momentarily.",
        });
        setShowPaymentSetup(false);
        queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
        return;
      }
      
      const amount = calculateTotalAmount();
      const hasOutstandingBalance = financials.amountPastDue > 0;
      let squareCardId: string | null = null;
      let paymentWasCharged = false;

      if (isAutoPay && !hasOutstandingBalance) {
        if (cardMode === 'saved' && selectedSavedCardId) {
          squareCardId = selectedSavedCardId;
        } else {
          const token = await tokenizeCard(card);
          const saveResponse = await csrfFetch(`/api/square/cards/${bowler.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourceId: token }),
          });
          const saveData = await saveResponse.json();
          if (!saveResponse.ok) {
            throw new Error(saveData.error?.message || 'Failed to save card');
          }
          squareCardId = saveData.data?.savedCardId || null;
          if (!squareCardId) {
            throw new Error('Your card could not be saved for auto-pay. Please try again.');
          }
          queryClient.invalidateQueries({ queryKey: [`/api/square/cards/${bowler.id}`] });
        }
      } else if (cardMode === 'saved' && selectedSavedCardId) {
        const response = await csrfFetch('/api/square/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceId: selectedSavedCardId,
            amount,
            bowlerId: bowler.id,
            leagueId: league.id,
            storeCard: false,
          }),
        });
        const responseData = await response.json();
        if (!response.ok) {
          throw new Error(responseData.error?.message || 'Payment failed');
        }
        squareCardId = selectedSavedCardId;
        paymentWasCharged = true;
      } else {
        const shouldStore = isAutoPay || storeCard;
        const paymentResult = await createPayment(amount, card, bowler.id, league.id, shouldStore);
        if (shouldStore) {
          queryClient.invalidateQueries({ queryKey: [`/api/square/cards/${bowler.id}`] });
        }
        if (isAutoPay) {
          squareCardId = paymentResult.savedCardId || null;
          if (!squareCardId) {
            throw new Error('Your card could not be saved for auto-pay. Please try again.');
          }
        }
        paymentWasCharged = true;
      }

      if (isAutoPay && squareCardId) {
        const recurringAmount = weeklyFee;
        const scheduleResponse = await csrfFetch('/api/payment-schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bowlerId: bowler.id,
            leagueId: league.id,
            frequency: selectedSchedule,
            amount: recurringAmount,
            nextPaymentDate: new Date(),
            squareCardId,
            includeFinalTwoWeeks,
          }),
        });
        if (!scheduleResponse.ok) {
          const scheduleData = await scheduleResponse.json();
          throw new Error(scheduleData.error?.message || 'Failed to set up payment schedule');
        }
        queryClient.invalidateQueries({ queryKey: [`/api/payment-schedules/${bowler.id}/${league.id}`] });
      }

      if (isAutoPay) {
        toast({
          title: "Auto-Pay Activated",
          description: paymentWasCharged
            ? `Payment of ${formatCurrency(amount)} processed and ${selectedSchedule} auto-pay is now active.`
            : `Your card has been saved and ${selectedSchedule} auto-pay is now active.`,
        });
      } else {
        toast({
          title: "Payment Successful",
          description: includeFinalTwoWeeks
            ? `Payment of ${formatCurrency(amount)} processed (includes Final 2 Weeks).`
            : `Your payment of ${formatCurrency(amount)} has been processed.`,
        });
      }
      
      setIncludeFinalTwoWeeks(false);
      setShowPaymentSetup(false);
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
    } catch (error) {
      console.error('[Payment Error]:', error);
      let errorMessage = "Unable to process payment. Please try again.";
      if (typeof error === 'string') {
        errorMessage = error;
      } else if (error instanceof Error) {
        try {
          const parsed = JSON.parse(error.message);
          errorMessage = parsed.error?.message || error.message;
        } catch {
          errorMessage = error.message;
        }
      }
      toast({ title: "Payment Failed", description: errorMessage, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const seasonPresets = useMemo(() => {
    const seasonStarted = league.seasonStart && new Date(league.seasonStart) < new Date();
    const halfSeasonAmount = weeklyFee * Math.ceil(totalWeeks / 2);
    const hideFullSeason = financials.totalPaid > 0 && seasonStarted;
    const hideHalfSeason = financials.totalPaid >= halfSeasonAmount && seasonStarted;
    const presets: { label: string; weeks: number }[] = [];
    if (!hideHalfSeason) {
      presets.push({ label: "Half Season", weeks: Math.ceil(totalWeeks / 2) });
    }
    if (!hideFullSeason) {
      presets.push({ label: "Full Season", weeks: totalWeeks });
    }
    return presets;
  }, [totalWeeks, weeklyFee, financials.totalPaid, league.seasonStart]);

  const { data: scheduleResponse } = useQuery<{ success: boolean; data: ScheduleData }>({
    queryKey: [`/api/payment-schedules/${bowler.id}/${league.id}`],
    enabled: !!bowler.id && !!league.id,
    staleTime: 1000 * 60 * 5,
    retry: false,
  });
  const activeSchedule = scheduleResponse?.success ? scheduleResponse.data : undefined;

  if (showPaymentSetup) {
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
                onWeekChange={handleWeekChangeWrapper}
                onFixedAmount={(amount, type) => {
                  setFixedAmount(amount);
                  setFixedAmountType(type);
                  if (type === 'pastDue' && amount !== null) {
                    setSelectedWeeks(Math.max(1, Math.round(amount / weeklyFee)));
                  } else if (type === 'remaining') {
                    setSelectedWeeks(maxPayableWeeks);
                  }
                  setIncludeFinalTwoWeeks(false);
                }}
                onIncludeFinalTwoWeeksChange={setIncludeFinalTwoWeeks}
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
              onSubmit={handleSubmitPayment}
              onCancel={() => {
                setShowPaymentSetup(false);
                setShowFinalTwoWeeksWarning(false);
              }}
              onAddFinalTwoWeeks={() => {
                setIncludeFinalTwoWeeks(true);
                setShowFinalTwoWeeksWarning(false);
              }}
            />
          </div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <PaymentOverviewCard
      league={league}
      weeklyFee={weeklyFee}
      financials={financials}
      activeSchedule={activeSchedule}
      bowlerId={bowler.id}
      onSetupPayment={(mode) => {
        setPaymentMode(mode);
        if (mode === 'autopay') {
          setSelectedSchedule('weekly');
        } else {
          setSelectedSchedule('custom');
        }
        setShowPaymentSetup(true);
      }}
    />
  );
};
