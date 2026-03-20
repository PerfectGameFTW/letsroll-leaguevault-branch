import { FC, useRef, useEffect, useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, CreditCard, Plus, Minus, CalendarDays, AlertTriangle, Wallet } from "lucide-react";
import { useSquarePayment } from "@/hooks/use-square-payment";
import { createPayment, tokenizeCard } from "@/lib/square";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/utils";
import { calculateFinancials } from "@/lib/financial-utils";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import type { League, Bowler, Payment, SavedCard } from "@shared/schema";

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
  const [isCancelling, setIsCancelling] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
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
      const res = await fetch(`/api/square/cards/${bowler.id}?leagueId=${league.id}`);
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

  const incrementWeeks = useCallback(() => {
    handleWeekChangeWrapper(selectedWeeks + 1);
  }, [handleWeekChangeWrapper, selectedWeeks]);

  const decrementWeeks = useCallback(() => {
    handleWeekChangeWrapper(selectedWeeks - 1);
  }, [handleWeekChangeWrapper, selectedWeeks]);

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
      toast({
        title: "Payment Setup Error",
        description: "Please enter your card details before proceeding.",
        variant: "destructive",
      });
      return;
    }

    if (cardMode === 'saved' && !selectedSavedCardId) {
      toast({
        title: "Payment Setup Error",
        description: "Please select a saved card.",
        variant: "destructive",
      });
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
          const saveResponse = await fetch(`/api/square/cards/${bowler.id}`, {
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

        const scheduleResponse = await fetch('/api/payment-schedules', {
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
          const saveResponse = await fetch(`/api/square/cards/${bowler.id}`, {
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
        const response = await fetch('/api/square/payments', {
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
        const scheduleResponse = await fetch('/api/payment-schedules', {
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
      toast({
        title: "Payment Failed",
        description: errorMessage,
        variant: "destructive",
      });
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


  const cancelScheduleMutation = useMutation({
    mutationFn: async (scheduleId: number) => {
      return apiRequest(`/api/payment-schedules/${scheduleId}`, 'DELETE');
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: [`/api/payment-schedules/${bowler.id}/${league.id}`] });
      setShowCancelConfirm(false);
      toast({ title: "Auto-pay cancelled", description: "Your automatic payment schedule has been cancelled." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to cancel auto-pay. Please try again.", variant: "destructive" });
    },
  });

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
                      onClick={decrementWeeks}
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
                      onChange={(e) => handleWeekChangeWrapper(parseInt(e.target.value, 10))}
                      className="flex h-10 w-16 rounded-md border border-input bg-background px-3 py-2 text-sm text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={incrementWeeks}
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
                        onClick={() => handleWeekChangeWrapper(preset.weeks)}
                      >
                        {preset.label}
                      </Button>
                    ))}
                    {financials.amountPastDue > 0 && (
                      <Button
                        variant={fixedAmountType === 'pastDue' ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                          setFixedAmount(financials.amountPastDue);
                          setFixedAmountType('pastDue');
                          setSelectedWeeks(Math.max(1, Math.round(financials.amountPastDue / weeklyFee)));
                          setIncludeFinalTwoWeeks(false);
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
                          setFixedAmount(financials.remainingBalance);
                          setFixedAmountType('remaining');
                          setSelectedWeeks(maxPayableWeeks);
                          setIncludeFinalTwoWeeks(false);
                        }}
                      >
                        Season Remaining Balance
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
            
            {!financials.finalTwoWeeks.isPaid && financials.finalTwoWeeks.amount > 0 && fixedAmountType !== 'remaining' && fixedAmountType !== 'pastDue' && !(fixedAmount === null && selectedWeeks === totalWeeks) && (
              <div className="flex items-start space-x-3 rounded-md border p-4 bg-muted/50">
                <Checkbox
                  id="include-final-two-weeks"
                  checked={includeFinalTwoWeeks}
                  onCheckedChange={(checked) => setIncludeFinalTwoWeeks(checked === true)}
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

            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-medium">Payment Information</h3>
                <p className="text-sm text-muted-foreground">
                  {savedCards.length > 0
                    ? "Use a saved card or enter new card details"
                    : "Enter your card details (securely processed by Square)"}
                </p>
              </div>

              {savedCards.length > 0 && (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={cardMode === 'saved' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      cleanupCard();
                      setCardMode('saved');
                    }}
                    className="flex items-center gap-2"
                  >
                    <Wallet className="h-4 w-4" />
                    Saved Card
                  </Button>
                  <Button
                    type="button"
                    variant={cardMode === 'new' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      if (cardMode === 'new') return;
                      cleanupCard();
                      setCardMode('new');
                    }}
                    className="flex items-center gap-2"
                  >
                    <CreditCard className="h-4 w-4" />
                    New Card
                  </Button>
                </div>
              )}

              {cardMode === 'saved' && savedCards.length > 0 ? (
                <div className="space-y-3">
                  <Select value={selectedSavedCardId} onValueChange={setSelectedSavedCardId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a saved card" />
                    </SelectTrigger>
                    <SelectContent>
                      {savedCards.map((sc) => (
                        <SelectItem key={sc.id} value={sc.id}>
                          {sc.brand} ending in {sc.last4} (exp {sc.expMonth}/{sc.expYear})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <>
                  <div ref={cardContainerRef} className="min-h-[200px] border rounded-lg bg-card p-4">
                    {!isInitialized && (
                      <div className="flex items-center justify-center p-4">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        <p className="ml-2 text-sm text-muted-foreground">
                          Loading credit card form...
                        </p>
                      </div>
                    )}
                  </div>
                  {selectedSchedule === 'custom' && (
                    <div className="flex items-center space-x-3">
                      <Checkbox
                        id="store-card-status"
                        checked={storeCard}
                        onCheckedChange={(checked) => setStoreCard(checked === true)}
                      />
                      <Label htmlFor="store-card-status" className="text-sm cursor-pointer">
                        Save this card for future payments
                      </Label>
                    </div>
                  )}
                </>
              )}

              {squareError && cardMode === 'new' && (
                <div className="p-3 text-sm border border-destructive bg-destructive/10 text-destructive rounded-md">
                  <p><strong>Credit Card Form Error:</strong> {squareError}</p>
                  <p className="mt-1 text-xs">Consider using Cash or Check payment instead.</p>
                </div>
              )}
              
            </div>
            
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
                  {includeFinalTwoWeeks && ` + Final 2 Weeks (${formatCurrency(financials.finalTwoWeeks.amount)})`}
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
                      You haven't included the Final 2 Weeks payment ({formatCurrency(financials.finalTwoWeeks.amount)}) due by Week {financials.finalTwoWeeks.dueByWeek}. 
                      If not paid now, it will be automatically charged to your card on the week it's due.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIncludeFinalTwoWeeks(true);
                      setShowFinalTwoWeeksWarning(false);
                    }}
                  >
                    Add Final 2 Weeks Now
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleSubmitPayment}
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
                onClick={() => {
                  setShowPaymentSetup(false);
                  setShowFinalTwoWeeksWarning(false);
                }}
              >
                Cancel
              </Button>
              <Button 
                onClick={handleSubmitPayment}
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
                  `Pay ${formatCurrency(financials.fullSeasonAmount)}`
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
          </div>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment Overview</CardTitle>
      </CardHeader>
      <CardContent className="pt-6 space-y-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Full Season Total Due</span>
            <span className="text-sm font-medium">{formatCurrency(financials.fullSeasonAmount)}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Weekly Fee</span>
            <span className="text-sm font-medium">{formatCurrency(weeklyFee)}/week</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Amount Due to Date</span>
            <span className="text-sm font-medium">{formatCurrency(financials.totalDueToDate)}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Amount Paid to Date</span>
            <span className="text-sm font-medium">{formatCurrency(financials.totalPaid)}</span>
          </div>

          {financials.amountPastDue > 0 && (
            <div className="flex items-center justify-between rounded-md bg-destructive/10 px-3 py-2">
              <span className="text-sm font-medium text-destructive flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                Past Due
              </span>
              <span className="text-sm font-bold text-destructive">{formatCurrency(financials.amountPastDue)}</span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Full Season Remaining Balance</span>
            <span className="text-sm font-medium">{formatCurrency(financials.remainingBalance)}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Payment Schedule</span>
            <span className="text-sm font-medium">
              {activeSchedule
                ? activeSchedule.frequency === 'upfront'
                  ? `Full season (${formatCurrency(activeSchedule.amount)})`
                  : `Auto-pay: ${formatCurrency(activeSchedule.amount)}/${activeSchedule.frequency === 'weekly' ? 'week' : 'month'}`
                : 'No payment set up'}
            </span>
          </div>

          {activeSchedule && (
            <div className="flex items-center justify-between pl-5">
              <span className="text-xs text-muted-foreground">Next payment</span>
              <span className="text-xs text-muted-foreground">
                {formatInTimeZone(new Date(activeSchedule.nextPaymentDate), activeSchedule.leagueTimezone || 'America/Chicago', 'MMM d, yyyy h:mm a')}
              </span>
            </div>
          )}

          {league.paymentMode !== 'upfront' && financials.finalTwoWeeks.amount > 0 && !financials.finalTwoWeeks.isPaid && (
            <div className={`flex items-center justify-between rounded-md px-3 py-2 ${
              financials.finalTwoWeeks.isPastDue
                  ? 'bg-destructive/10'
                  : 'bg-muted'
            }`}>
              <div className="flex flex-col gap-0.5">
                <span className={`text-sm font-medium flex items-center gap-1.5 ${
                  financials.finalTwoWeeks.isPastDue ? 'text-destructive' : ''
                }`}>
                  {financials.finalTwoWeeks.isPastDue
                    ? <AlertTriangle className="h-3.5 w-3.5" />
                    : <CalendarDays className="h-3.5 w-3.5" />
                  }
                  Final 2 Weeks
                </span>
                <span className="text-xs text-muted-foreground pl-5">
                  Due by Week {financials.finalTwoWeeks.dueByWeek}
                  {financials.finalTwoWeeks.dueByDate && ` (${format(financials.finalTwoWeeks.dueByDate, 'MMM d, yyyy')})`}
                </span>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span className={`text-sm font-bold ${
                  financials.finalTwoWeeks.isPastDue ? 'text-destructive' : ''
                }`}>
                  {formatCurrency(financials.finalTwoWeeks.amount)}
                </span>
                <span className={`text-xs font-medium ${
                  financials.finalTwoWeeks.isPastDue ? 'text-destructive' : 'text-muted-foreground'
                }`}>
                  {financials.finalTwoWeeks.isPastDue ? 'Past Due' : 'Due'}
                </span>
              </div>
            </div>
          )}

        </div>

        <Separator />

        {activeSchedule && !showCancelConfirm && (
          <Button
            variant="ghost"
            onClick={() => setShowCancelConfirm(true)}
            className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            Cancel Auto-Pay
          </Button>
        )}

        {activeSchedule && showCancelConfirm && (
          <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-sm font-medium">Are you sure you want to cancel auto-pay?</p>
            <p className="text-xs text-muted-foreground">You will need to set it up again if you change your mind.</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowCancelConfirm(false)}
                className="flex-1"
                size="sm"
              >
                Keep It
              </Button>
              <Button
                variant="destructive"
                onClick={() => cancelScheduleMutation.mutate(activeSchedule.id)}
                disabled={cancelScheduleMutation.isPending}
                className="flex-1"
                size="sm"
              >
                {cancelScheduleMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Yes, Cancel
              </Button>
            </div>
          </div>
        )}

        {!activeSchedule && league.paymentMode === 'upfront' && (
          <div className="space-y-2">
            <Button className="w-full" onClick={() => setShowPaymentSetup(true)}>
              Pay Full Season ({formatCurrency(financials.fullSeasonAmount)})
              <CreditCard className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}

        {!activeSchedule && league.paymentMode !== 'upfront' && (
          <div className="space-y-2">
              <Button
                onClick={() => { setPaymentMode('autopay'); setSelectedSchedule('weekly'); setShowPaymentSetup(true); }}
                className="w-full"
              >
                {financials.amountPastDue > 0
                  ? `Pay ${formatCurrency(financials.amountPastDue)} & Set Up Auto-Pay`
                  : 'Set Up Auto-Pay'}
                <CreditCard className="ml-2 h-4 w-4" />
              </Button>
            <Button
              variant="outline"
              onClick={() => { setPaymentMode('onetime'); setSelectedSchedule('custom'); setShowPaymentSetup(true); }}
              className="w-full"
            >
              Make One-Time Payment
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
