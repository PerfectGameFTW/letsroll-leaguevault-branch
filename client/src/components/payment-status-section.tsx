import { FC, useRef, useEffect, useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Loader2, CreditCard, Calendar, Plus, Minus, CalendarDays, Settings, DollarSign, AlertTriangle, RefreshCw, CheckCircle2 } from "lucide-react";
import { useSquarePayment } from "@/hooks/use-square-payment";
import { createPayment } from "@/lib/square";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/utils";
import { calculateFinancials } from "@/lib/financial-utils";
import { format } from "date-fns";
import type { League, Bowler, Payment } from "@shared/schema";

type PaymentSchedule = "weekly" | "monthly" | "custom";

interface ScheduleData {
  id: number;
  frequency: string;
  nextPaymentDate: string;
  amount: number;
  active: boolean;
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
  const [isCancelling, setIsCancelling] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const { card, isInitialized, error: squareError, initializeCard } = useSquarePayment({
    onError: (error) => {
      console.error('[Square Payment Error]:', error);
      toast({
        title: "Payment Setup Error",
        description: error,
        variant: "destructive",
      });
    }
  });

  useEffect(() => {
    if (showPaymentSetup && cardContainerRef.current) {
      initializeCard(cardContainerRef.current);
    }
  }, [showPaymentSetup, cardContainerRef, initializeCard]);

  const handleWeekChangeWrapper = useCallback((weeks: number) => {
    const validWeeks = Math.min(Math.max(1, weeks), totalWeeks);
    setSelectedWeeks(validWeeks);
    setFixedAmount(null);
    setFixedAmountType(null);
  }, [totalWeeks]);

  const incrementWeeks = useCallback(() => {
    handleWeekChangeWrapper(selectedWeeks + 1);
  }, [handleWeekChangeWrapper, selectedWeeks]);

  const decrementWeeks = useCallback(() => {
    handleWeekChangeWrapper(selectedWeeks - 1);
  }, [handleWeekChangeWrapper, selectedWeeks]);

  const calculateTotalAmount = useCallback(() => {
    if (fixedAmount !== null) {
      return fixedAmount;
    }
    if (selectedSchedule === 'custom') {
      return weeklyFee * selectedWeeks;
    } else if (selectedSchedule === 'monthly') {
      return weeklyFee * 4;
    } else {
      return weeklyFee;
    }
  }, [selectedSchedule, weeklyFee, selectedWeeks, fixedAmount]);

  const handleSubmitPayment = async () => {
    if (!card) {
      toast({
        title: "Payment Setup Error",
        description: "Missing required information to set up payment.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsSubmitting(true);
      
      const amount = calculateTotalAmount();
      const result = await createPayment(
        amount,
        card,
        bowler.id, 
        league.id,
        storeCard
      );

      toast({
        title: "Payment Setup Successful",
        description: `Your ${selectedSchedule} payment schedule has been set up.`,
      });
      
      setShowPaymentSetup(false);
    } catch (error) {
      console.error('[Payment Error]:', error);
      toast({
        title: "Payment Failed",
        description: typeof error === 'string' ? error : "Unable to process payment. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const bowlerPayments = useMemo(() => {
    return (payments || []).filter(p => p.bowlerId === bowler.id && p.leagueId === league.id);
  }, [payments, bowler.id, league.id]);

  const financials = useMemo(() => {
    return calculateFinancials(league, bowlerPayments);
  }, [league, bowlerPayments]);

  const seasonPresets = useMemo(() => {
    const seasonStarted = league.seasonStart && new Date(league.seasonStart) < new Date();
    const halfSeasonAmount = weeklyFee * Math.ceil(totalWeeks / 2);
    const hideFullSeason = financials.totalPaid > 0 && seasonStarted;
    const hideHalfSeason = financials.totalPaid >= halfSeasonAmount && seasonStarted;
    const presets: { label: string; weeks: number }[] = [
      { label: "1 Month", weeks: 4 },
    ];
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
  });
  const activeSchedule = scheduleResponse?.success ? scheduleResponse.data : undefined;

  const formatDollars = useCallback((cents: number) => `$${(cents / 100).toFixed(2)}`, []);

  const cancelScheduleMutation = useMutation({
    mutationFn: async (scheduleId: number) => {
      return apiRequest(`/api/payment-schedules/${scheduleId}`, 'DELETE');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/payment-schedules/${bowler.id}/${league.id}`] });
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
        <CardHeader>
          <CardTitle>{paymentMode === 'onetime' ? 'Make One-Time Payment' : 'Set Up Automatic Payments'}</CardTitle>
          <CardDescription>{paymentMode === 'onetime' ? 'Enter your card to make a payment' : 'Configure your payment schedule for the league'}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {paymentMode === 'autopay' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-medium">Payment Schedule</h3>
                <p className="text-sm text-muted-foreground">
                  Choose how often you want to be charged
                </p>
              </div>
              
              <RadioGroup
                value={selectedSchedule}
                onValueChange={(value) => setSelectedSchedule(value as PaymentSchedule)}
                className="grid grid-cols-1 md:grid-cols-2 gap-4"
              >
                <div>
                  <RadioGroupItem value="weekly" id="weekly" className="sr-only" />
                  <Label
                    htmlFor="weekly"
                    className={`flex flex-col items-center justify-between rounded-md border-2 border-muted p-4 cursor-pointer ${
                      selectedSchedule === 'weekly' 
                        ? 'border-primary bg-primary/5' 
                        : 'hover:border-primary/50 hover:bg-primary/5'
                    }`}
                  >
                    <CalendarDays className="h-6 w-6 mb-2" />
                    <span className="text-sm font-medium">Weekly</span>
                    <span className="text-xs text-muted-foreground mt-1">
                      {formatCurrency(weeklyFee)} per week
                    </span>
                  </Label>
                </div>
                
                <div>
                  <RadioGroupItem value="monthly" id="monthly" className="sr-only" />
                  <Label
                    htmlFor="monthly"
                    className={`flex flex-col items-center justify-between rounded-md border-2 border-muted p-4 cursor-pointer ${
                      selectedSchedule === 'monthly' 
                        ? 'border-primary bg-primary/5' 
                        : 'hover:border-primary/50 hover:bg-primary/5'
                    }`}
                  >
                    <Calendar className="h-6 w-6 mb-2" />
                    <span className="text-sm font-medium">Monthly</span>
                    <span className="text-xs text-muted-foreground mt-1">
                      {formatCurrency(weeklyFee * 4)} per month
                    </span>
                  </Label>
                </div>
                
              </RadioGroup>
            </div>
            )}
            
            {selectedSchedule === 'custom' && (
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
                      max={totalWeeks}
                      value={selectedWeeks}
                      onChange={(e) => handleWeekChangeWrapper(parseInt(e.target.value, 10))}
                      className="flex h-10 w-16 rounded-md border border-input bg-background px-3 py-2 text-sm text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={incrementWeeks}
                      disabled={selectedWeeks >= totalWeeks}
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
                        }}
                      >
                        Season Remaining Balance
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
            
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-medium">Payment Information</h3>
                <p className="text-sm text-muted-foreground">
                  Enter your card details (securely processed by Square)
                </p>
              </div>
              
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
              
              {squareError && (
                <div className="p-3 text-sm border border-destructive bg-destructive/10 text-destructive rounded-md">
                  <p><strong>Credit Card Form Error:</strong> {squareError}</p>
                  <p className="mt-1 text-xs">Consider using Cash or Check payment instead.</p>
                </div>
              )}
              
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="store-card" 
                  checked={storeCard}
                  onCheckedChange={(checked) => setStoreCard(checked === true)} 
                />
                <Label htmlFor="store-card">Save card for future payments</Label>
              </div>
            </div>
            
            <div className="pt-4 border-t">
              <div className="flex justify-between items-center">
                <span className="text-lg font-medium">Total Amount</span>
                <span className="text-lg font-bold">{formatCurrency(calculateTotalAmount())}</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {selectedSchedule === 'weekly' && 'Charged weekly'}
                {selectedSchedule === 'monthly' && 'Charged monthly (every 4 weeks)'}
                {selectedSchedule === 'custom' && `One-time payment for ${selectedWeeks} weeks`}
              </p>
            </div>
            
            <div className="flex flex-col sm:flex-row sm:justify-between gap-2">
              <Button 
                variant="outline"
                onClick={() => setShowPaymentSetup(false)}
              >
                Cancel
              </Button>
              <Button 
                onClick={handleSubmitPayment}
                disabled={!isInitialized || isSubmitting}
                className="min-w-[200px]"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>{selectedSchedule === 'custom' ? 'Make One-Time Payment' : 'Set Up Automatic Payments'}</>
                )}
              </Button>
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
            <span className="text-sm text-muted-foreground flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5" />
              Weekly Fee
            </span>
            <span className="text-sm font-medium">{formatDollars(weeklyFee)}/week</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" />
              Full Season Total
            </span>
            <span className="text-sm font-medium">{formatDollars(financials.fullSeasonAmount)}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5" />
              Amount Paid to Date
            </span>
            <span className="text-sm font-medium">{formatDollars(financials.totalPaid)}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5" />
              Full Season Remaining Balance
            </span>
            <span className="text-sm font-medium">{formatDollars(financials.remainingBalance)}</span>
          </div>

          {financials.finalTwoWeeks.amount > 0 && (
            <div className={`flex items-center justify-between rounded-md px-3 py-2 ${
              financials.finalTwoWeeks.isPaid
                ? 'bg-green-500/10'
                : financials.finalTwoWeeks.isPastDue
                  ? 'bg-destructive/10'
                  : 'bg-muted'
            }`}>
              <div className="flex flex-col gap-0.5">
                <span className={`text-sm font-medium flex items-center gap-1.5 ${
                  financials.finalTwoWeeks.isPaid
                    ? 'text-green-600'
                    : financials.finalTwoWeeks.isPastDue
                      ? 'text-destructive'
                      : ''
                }`}>
                  {financials.finalTwoWeeks.isPaid
                    ? <CheckCircle2 className="h-3.5 w-3.5" />
                    : financials.finalTwoWeeks.isPastDue
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
                  financials.finalTwoWeeks.isPaid
                    ? 'text-green-600'
                    : financials.finalTwoWeeks.isPastDue
                      ? 'text-destructive'
                      : ''
                }`}>
                  {formatDollars(financials.finalTwoWeeks.amount)}
                </span>
                <span className={`text-xs font-medium ${
                  financials.finalTwoWeeks.isPaid
                    ? 'text-green-600'
                    : financials.finalTwoWeeks.isPastDue
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                }`}>
                  {financials.finalTwoWeeks.isPaid ? 'Paid' : financials.finalTwoWeeks.isPastDue ? 'Past Due' : 'Due'}
                </span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground flex items-center gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              Payment Schedule
            </span>
            <span className="text-sm font-medium">
              {activeSchedule
                ? `Auto-pay: ${activeSchedule.frequency === 'weekly' ? 'Weekly' : 'Monthly'} — ${formatDollars(activeSchedule.amount)}`
                : 'No auto-pay'}
            </span>
          </div>

          {activeSchedule && (
            <div className="flex items-center justify-between pl-5">
              <span className="text-xs text-muted-foreground">Next payment</span>
              <span className="text-xs text-muted-foreground">
                {format(new Date(activeSchedule.nextPaymentDate), 'MMM d, yyyy h:mm a')}
              </span>
            </div>
          )}

          {financials.amountPastDue > 0 && (
            <div className="flex items-center justify-between rounded-md bg-destructive/10 px-3 py-2">
              <span className="text-sm font-medium text-destructive flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                Past Due
              </span>
              <span className="text-sm font-bold text-destructive">{formatDollars(financials.amountPastDue)}</span>
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

        {!activeSchedule && (
          <div className="space-y-2">
            {financials.amountPastDue > 0 ? (
              <p className="text-sm text-muted-foreground text-center">
                Auto-pay is unavailable until your past due balance is paid in full.
              </p>
            ) : (
              <Button
                onClick={() => { setPaymentMode('autopay'); setSelectedSchedule('weekly'); setShowPaymentSetup(true); }}
                className="w-full"
              >
                Set Up Auto-Pay
                <CreditCard className="ml-2 h-4 w-4" />
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => { setPaymentMode('onetime'); setSelectedSchedule('custom'); setShowPaymentSetup(true); }}
              className="w-full"
            >
              Make One-Time Payment
              <DollarSign className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
