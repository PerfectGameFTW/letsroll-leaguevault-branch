import { FC, useRef, useEffect, useState, useMemo, useCallback } from "react";
import { useSquarePayment } from "@/hooks/use-square-payment";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { csrfFetch } from '@/lib/queryClient';
import { calculateFinancials } from "@/lib/financial-utils";
import type { League, Bowler, Payment, SavedCard } from "@shared/schema";
import { PaymentOverviewCard } from "@/components/payment-overview-card";
import { PaymentSetupForm } from "@/components/payment-setup-form";
import { useBowlerPaymentSubmit } from "@/hooks/use-bowler-payment-submit";

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

  const handleSubmitPayment = useBowlerPaymentSubmit({
    league,
    bowler,
    weeklyFee,
    card,
    cardMode,
    selectedSavedCardId,
    selectedSchedule,
    storeCard,
    includeFinalTwoWeeks,
    showFinalTwoWeeksWarning,
    financials,
    calculateTotalAmount,
    setIsSubmitting,
    setShowFinalTwoWeeksWarning,
    setIncludeFinalTwoWeeks,
    setShowPaymentSetup,
  });

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
      <PaymentSetupForm
        league={league}
        weeklyFee={weeklyFee}
        totalWeeks={totalWeeks}
        paymentMode={paymentMode}
        selectedSchedule={selectedSchedule}
        selectedWeeks={selectedWeeks}
        maxPayableWeeks={maxPayableWeeks}
        fixedAmount={fixedAmount}
        fixedAmountType={fixedAmountType}
        includeFinalTwoWeeks={includeFinalTwoWeeks}
        showFinalTwoWeeksWarning={showFinalTwoWeeksWarning}
        financials={financials}
        seasonPresets={seasonPresets}
        savedCards={savedCards}
        cardMode={cardMode}
        selectedSavedCardId={selectedSavedCardId}
        cardContainerRef={cardContainerRef}
        isInitialized={isInitialized}
        squareError={squareError}
        storeCard={storeCard}
        isSubmitting={isSubmitting}
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
        setCardMode={setCardMode}
        setSelectedSavedCardId={setSelectedSavedCardId}
        setStoreCard={setStoreCard}
        cleanupCard={cleanupCard}
        calculateTotalAmount={calculateTotalAmount}
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
