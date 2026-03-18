import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BowlerLayout } from "@/components/bowler-layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, AlertCircle, AlertTriangle, CreditCard, Wallet } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSquarePayment } from "@/hooks/use-square-payment";
import { createPayment, tokenizeCard } from "@/lib/square";
import { useParams, useLocation } from "wouter";
import type { League, BowlerLeague, Payment, Bowler } from "@shared/schema";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getSeasonLengthWeeks, calculateFinancials } from "@/lib/financial-utils";
import { formatCurrency } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";

interface SavedCard {
  id: string;
  last4: string;
  brand: string;
  expMonth: number;
  expYear: number;
}

type PaymentSchedule = "weekly" | "monthly" | "custom" | "upfront";

interface PaymentOption {
  id: PaymentSchedule;
  label: string;
  description: string;
  calculateAmount: (weeklyFee: number, totalWeeks: number, customWeeks?: number) => number;
}

const WEEKLY_PAYMENT_OPTIONS: PaymentOption[] = [
  {
    id: "weekly",
    label: "Weekly Automatic Payment",
    description: "Your card will be charged weekly for league dues",
    calculateAmount: (weeklyFee) => weeklyFee,
  },
  {
    id: "monthly",
    label: "Monthly Automatic Payment",
    description: "Your card will be charged monthly (4 weeks of dues)",
    calculateAmount: (weeklyFee) => weeklyFee * 4,
  },
  {
    id: "custom",
    label: "One Time Payment",
    description: "Make a single payment for your selected number of weeks",
    calculateAmount: (weeklyFee, _, customWeeks = 1) => weeklyFee * customWeeks,
  },
];

const UPFRONT_PAYMENT_OPTIONS: PaymentOption[] = [
  {
    id: "upfront",
    label: "Pay Full Season",
    description: "Pay the full season amount in one payment",
    calculateAmount: (weeklyFee, totalWeeks) => weeklyFee * totalWeeks,
  },
];

export default function BowlerPaymentSetupPage() {
  const params = useParams();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const bowlerId = parseInt(params.bowlerId!);
  const queryClient = useQueryClient();
  const [selectedSchedule, setSelectedSchedule] = useState<PaymentSchedule | null>(null);
  const cardContainerRef = useRef<HTMLDivElement>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [customWeeks, setCustomWeeks] = useState(1);
  const [includeFinalTwoWeeks, setIncludeFinalTwoWeeks] = useState(false);
  const [showFinalTwoWeeksWarning, setShowFinalTwoWeeksWarning] = useState(false);
  const [storeCard, setStoreCard] = useState(false);
  const [cardMode, setCardMode] = useState<'new' | 'saved'>('new');
  const [selectedSavedCardId, setSelectedSavedCardId] = useState<string>('');

  const { card, isInitialized, error: squareError, initializeCard, cleanupCard } = useSquarePayment({
    onError: (error) => {
      console.error('[BowlerPaymentSetup] Square initialization error:', error);
      toast({
        title: "Payment Setup Error",
        description: error,
        variant: "destructive",
      });
    },
  });

  const { data: bowlerResponse } = useQuery<{ data: Bowler }>({
    queryKey: [`/api/bowlers/${bowlerId}`],
    enabled: !!bowlerId,
  });
  const bowler = bowlerResponse?.data;

  const { data: bowlerLeaguesResponse } = useQuery<{ data: BowlerLeague[] }>({
    queryKey: ["/api/bowler-leagues"],
    enabled: !!bowlerId,
  });
  const bowlerLeagues = (bowlerLeaguesResponse?.data || []).filter(bl => bl.bowlerId === bowlerId);

  const leagueId = bowlerLeagues[0]?.leagueId;
  const { data: leagueResponse } = useQuery<{ data: League }>({
    queryKey: [`/api/leagues/${leagueId}`],
    enabled: !!leagueId,
  });
  const league = leagueResponse?.data;
  const isUpfrontLeague = league?.paymentMode === 'upfront';
  const PAYMENT_OPTIONS = isUpfrontLeague ? UPFRONT_PAYMENT_OPTIONS : WEEKLY_PAYMENT_OPTIONS;

  useEffect(() => {
    if (league) {
      setSelectedSchedule(isUpfrontLeague ? 'upfront' : 'weekly');
    }
  }, [league?.id, isUpfrontLeague]);

  const resolvedSchedule = selectedSchedule ?? (isUpfrontLeague ? 'upfront' : 'weekly');

  const { data: paymentsResponse } = useQuery<{ data: Payment[] }>({
    queryKey: ["/api/payments"],
  });
  const bowlerPayments = (paymentsResponse?.data || []).filter(
    p => p.bowlerId === bowlerId && league && p.leagueId === league.id
  );
  const financials = calculateFinancials(league || null, bowlerPayments);

  const { data: savedCardsResponse } = useQuery<{ success: boolean; data: SavedCard[] }>({
    queryKey: [`/api/square/cards/${bowlerId}`],
    enabled: !!bowlerId,
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
    if (cardContainerRef.current && !isInitialized && cardMode === 'new') {
      initializeCard(cardContainerRef.current);
    }
  }, [isInitialized, initializeCard, cardMode]);

  const calculatePaymentAmount = () => {
    if (!league) return 0;

    const selectedOption = PAYMENT_OPTIONS.find(opt => opt.id === resolvedSchedule);
    if (!selectedOption) return 0;

    const totalWeeks = getSeasonLengthWeeks(league);

    let amount = selectedOption.calculateAmount(league.weeklyFee, totalWeeks, customWeeks);
    if (!isUpfrontLeague && includeFinalTwoWeeks) {
      amount += league.weeklyFee * 2;
    }
    return amount;
  };

  const isAutoPay = !isUpfrontLeague && resolvedSchedule !== 'custom';

  const handleSubmit = async () => {
    if (!league) {
      toast({
        title: "Payment Setup Error",
        description: "Unable to process payment at this time. Please try again later.",
        variant: "destructive",
      });
      return;
    }

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

    const finalTwoWeeksUnpaid = !isUpfrontLeague && !financials.finalTwoWeeks.isPaid && financials.finalTwoWeeks.amount > 0;

    if (isAutoPay && finalTwoWeeksUnpaid && !includeFinalTwoWeeks && !showFinalTwoWeeksWarning) {
      setShowFinalTwoWeeksWarning(true);
      return;
    }

    try {
      setPaymentError(null);
      setIsProcessing(true);
      setShowFinalTwoWeeksWarning(false);

      if (isAutoPay) {
        // Auto-pay setup: save the card and create a recurring schedule.
        // The base recurring amount (weeklyFee or weeklyFee × 4) is always the schedule amount.
        const totalWeeks = getSeasonLengthWeeks(league);
        const selectedOption = PAYMENT_OPTIONS.find(opt => opt.id === resolvedSchedule)!;
        const recurringAmount = selectedOption.calculateAmount(league.weeklyFee, totalWeeks, customWeeks);

        // Only charge upfront if the bowler has an outstanding balance.
        const hasOutstandingBalance = financials.amountPastDue > 0;
        let squareCardId: string;

        if (hasOutstandingBalance) {
          // Charge what they currently owe (plus final 2 weeks if opted in), then save card.
          const initialAmount = calculatePaymentAmount();
          if (initialAmount <= 0) throw new Error("Invalid payment amount calculated");

          if (cardMode === 'saved' && selectedSavedCardId) {
            const response = await fetch('/api/square/payments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sourceId: selectedSavedCardId,
                amount: initialAmount,
                bowlerId,
                leagueId: league.id,
                storeCard: false,
              }),
            });
            const responseData = await response.json();
            if (!response.ok) {
              throw new Error(JSON.stringify({
                error: { message: responseData.error?.message || 'Payment failed', code: 'PAYMENT_FAILED' }
              }));
            }
            squareCardId = selectedSavedCardId;
          } else {
            // New card — charge and store in one step
            const paymentResult = await createPayment(initialAmount, card, bowlerId, league.id, true);
            queryClient.invalidateQueries({ queryKey: [`/api/square/cards/${bowlerId}`] });
            if (!paymentResult.savedCardId) {
              throw new Error(JSON.stringify({
                error: { message: 'Your card could not be saved for auto-pay. Please try again.', code: 'CARD_SAVE_FAILED' }
              }));
            }
            squareCardId = paymentResult.savedCardId;
          }
        } else {
          // Bowler is fully current — no charge needed, just save the card for future payments.
          if (cardMode === 'saved' && selectedSavedCardId) {
            squareCardId = selectedSavedCardId;
          } else {
            // Tokenize the card and save it on file without any charge
            const token = await tokenizeCard(card);
            const saveResponse = await fetch(`/api/square/cards/${bowlerId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sourceId: token }),
            });
            const saveData = await saveResponse.json();
            if (!saveResponse.ok || !saveData.data?.savedCardId) {
              throw new Error(JSON.stringify({
                error: { message: saveData.error?.message || 'Your card could not be saved. Please try again.', code: 'CARD_SAVE_FAILED' }
              }));
            }
            squareCardId = saveData.data.savedCardId;
            queryClient.invalidateQueries({ queryKey: [`/api/square/cards/${bowlerId}`] });
          }
        }

        // Create the recurring schedule with the real stored card ID
        const scheduleResponse = await fetch("/api/payment-schedules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bowlerId,
            leagueId: league.id,
            frequency: resolvedSchedule,
            amount: recurringAmount,
            nextPaymentDate: new Date(),
            squareCardId,
            includeFinalTwoWeeks,
          }),
        });

        if (!scheduleResponse.ok) {
          throw new Error("Failed to set up payment schedule");
        }
      } else if (isUpfrontLeague) {
        // Upfront league: save card and create a one-time 'upfront' schedule.
        // The scheduler will charge the full season amount once, then deactivate the schedule.
        const totalWeeks = getSeasonLengthWeeks(league);
        const upfrontOption = PAYMENT_OPTIONS.find(opt => opt.id === 'upfront')!;
        const upfrontAmount = upfrontOption.calculateAmount(league.weeklyFee, totalWeeks);

        let squareCardId: string;

        if (cardMode === 'saved' && selectedSavedCardId) {
          squareCardId = selectedSavedCardId;
        } else {
          const token = await tokenizeCard(card);
          const saveResponse = await fetch(`/api/square/cards/${bowlerId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourceId: token }),
          });
          const saveData = await saveResponse.json();
          if (!saveResponse.ok || !saveData.data?.savedCardId) {
            throw new Error(JSON.stringify({
              error: { message: saveData.error?.message || 'Your card could not be saved. Please try again.', code: 'CARD_SAVE_FAILED' }
            }));
          }
          squareCardId = saveData.data.savedCardId;
          queryClient.invalidateQueries({ queryKey: [`/api/square/cards/${bowlerId}`] });
        }

        // Create a one-time upfront schedule — the scheduler will charge immediately and deactivate it.
        const scheduleResponse = await fetch("/api/payment-schedules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bowlerId,
            leagueId: league.id,
            frequency: "upfront",
            amount: upfrontAmount,
            nextPaymentDate: new Date(),
            squareCardId,
            includeFinalTwoWeeks: false,
          }),
        });

        if (!scheduleResponse.ok) {
          const scheduleData = await scheduleResponse.json();
          throw new Error(JSON.stringify({
            error: { message: scheduleData.error?.message || 'Failed to set up payment schedule', code: 'SCHEDULE_FAILED' }
          }));
        }
      } else {
        // One-time / custom payment for weekly leagues
        const amount = calculatePaymentAmount();
        if (amount <= 0) throw new Error("Invalid payment amount calculated");

        if (cardMode === 'saved' && selectedSavedCardId) {
          const response = await fetch('/api/square/payments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sourceId: selectedSavedCardId,
              amount,
              bowlerId,
              leagueId: league.id,
              storeCard: false,
            }),
          });
          const responseData = await response.json();
          if (!response.ok) {
            throw new Error(JSON.stringify({
              error: { message: responseData.error?.message || 'Payment failed', code: 'PAYMENT_FAILED' }
            }));
          }
        } else {
          const paymentResult = await createPayment(amount, card, bowlerId, league.id, storeCard);
          if (storeCard && paymentResult.savedCardId) {
            queryClient.invalidateQueries({ queryKey: [`/api/square/cards/${bowlerId}`] });
          }
        }
      }

      const noChargeSetup = isAutoPay && financials.amountPastDue === 0;
      toast({
        title: isUpfrontLeague ? "Payment Scheduled" : noChargeSetup ? "Auto-Pay Activated" : "Payment Successful",
        description: isUpfrontLeague
          ? "Your card has been saved and your full season payment will be processed momentarily."
          : noChargeSetup
            ? `Your card has been saved and ${resolvedSchedule} auto-pay is now active. Your first charge will be on the next league night.`
            : resolvedSchedule === "custom"
              ? "Your one-time payment has been processed successfully."
              : `Your payment has been processed and ${resolvedSchedule} auto-pay is now active.`,
      });

      setLocation('/dashboard');

    } catch (error) {
      console.error('[BowlerPaymentSetup] Payment error:', error);
      let errorMessage: string;

      try {
        const parsedError = JSON.parse(error instanceof Error ? error.message : String(error));
        errorMessage = parsedError.error?.message || "Failed to process payment";
      } catch (parseError) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }

      setPaymentError(errorMessage);
      toast({
        title: "Payment Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  if (!league) {
    return (
      <BowlerLayout bowlerName={bowler?.name ?? ''} leagueName="">
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </BowlerLayout>
    );
  }

  return (
    <BowlerLayout bowlerName={bowler?.name ?? league.name} leagueName={league.name}>
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold">
            {isUpfrontLeague ? "Full Season Payment" : "Set Up League Payments"}
          </h1>
          <p className="text-muted-foreground">
            {isUpfrontLeague
              ? `Pay your full season dues for ${league.name} in one payment`
              : `Choose your preferred payment schedule for ${league.name}`}
          </p>
        </div>

        {paymentError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{paymentError}</AlertDescription>
          </Alert>
        )}

        {isUpfrontLeague ? (
          <Card>
            <CardHeader>
              <CardTitle>Season Summary</CardTitle>
              <CardDescription>Your full season dues will be charged in a single payment</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-muted-foreground">Weekly fee</span>
                <span className="text-sm">{formatCurrency(league.weeklyFee)} / week</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-muted-foreground">Season length</span>
                <span className="text-sm">{getSeasonLengthWeeks(league)} weeks</span>
              </div>
              <div className="border-t pt-3 flex items-center justify-between">
                <span className="font-semibold">Total due today</span>
                <span className="text-lg font-bold">{formatCurrency(financials.fullSeasonAmount)}</span>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Payment Schedule</CardTitle>
              <CardDescription>Select how you would like to pay your league dues</CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup
                value={resolvedSchedule}
                onValueChange={(value) => setSelectedSchedule(value as PaymentSchedule)}
                className="space-y-4"
              >
                {PAYMENT_OPTIONS.map((option) => {
                  const totalWeeks = getSeasonLengthWeeks(league);
                  const optionAmount = option.calculateAmount(league.weeklyFee, totalWeeks, customWeeks);
                  return (
                    <div key={option.id} className="flex items-center space-x-2">
                      <RadioGroupItem value={option.id} id={option.id} />
                      <Label htmlFor={option.id} className="flex flex-col">
                        <span className="font-medium">{option.label}</span>
                        <span className="text-sm text-muted-foreground">
                          {option.description}
                        </span>
                        <span className="text-sm font-semibold">
                          {formatCurrency(optionAmount)}
                        </span>
                      </Label>
                    </div>
                  );
                })}
              </RadioGroup>
            </CardContent>
          </Card>
        )}

        {!isUpfrontLeague && !financials.finalTwoWeeks.isPaid && financials.finalTwoWeeks.amount > 0 && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start space-x-3">
                <Checkbox
                  id="include-final-two-weeks-setup"
                  checked={includeFinalTwoWeeks}
                  onCheckedChange={(checked) => setIncludeFinalTwoWeeks(checked === true)}
                />
                <div className="space-y-1">
                  <Label htmlFor="include-final-two-weeks-setup" className="text-sm font-medium cursor-pointer">
                    Add Final 2 Weeks (${(financials.finalTwoWeeks.amount / 100).toFixed(2)})
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Pay the final 2 weeks upfront with your first payment. Due by Week {financials.finalTwoWeeks.dueByWeek}.
                    {resolvedSchedule !== 'custom' && ' Your auto-pay schedule will be reduced by 2 weeks.'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Payment Information</CardTitle>
            <CardDescription>
              {savedCards.length > 0
                ? "Use a saved card or enter new card details"
                : "Enter your card details to set up payments"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
                <div className="relative min-h-[200px] border rounded-lg bg-card">
                  <div ref={cardContainerRef} className="p-4" />
                  {!isInitialized && (
                    <div className="flex items-center justify-center p-4">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      <p className="ml-2 text-sm text-muted-foreground">
                        Loading credit card form...
                      </p>
                    </div>
                  )}
                  {isInitialized && (
                    <div className="absolute top-4 right-4">
                      <CreditCard className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                </div>
                {selectedSchedule === 'custom' && (
                  <div className="flex items-center space-x-3 pt-2">
                    <Checkbox
                      id="store-card"
                      checked={storeCard}
                      onCheckedChange={(checked) => setStoreCard(checked === true)}
                    />
                    <Label htmlFor="store-card" className="text-sm cursor-pointer">
                      Save this card for future payments
                    </Label>
                  </div>
                )}
              </>
            )}

            {squareError && cardMode === 'new' && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                <p>{squareError}</p>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="flex-1 border-t" />
              <span>Secure payment powered by Square</span>
              <div className="flex-1 border-t" />
            </div>
          </CardContent>
          {showFinalTwoWeeksWarning && (
            <CardContent className="pt-0">
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
                    onClick={handleSubmit}
                    disabled={isProcessing}
                  >
                    Continue Without
                  </Button>
                </div>
              </div>
            </CardContent>
          )}
          <CardFooter>
            <Button
              onClick={handleSubmit}
              disabled={
                (cardMode === 'new' && (!isInitialized || !!squareError)) ||
                (cardMode === 'saved' && !selectedSavedCardId) ||
                isProcessing
              }
              className="w-full"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isUpfrontLeague ? "Processing..." : isAutoPay && financials.amountPastDue === 0
                    ? "Setting Up Auto-Pay..."
                    : "Processing Payment..."}
                </>
              ) : isUpfrontLeague ? (
                `Pay ${formatCurrency(financials.fullSeasonAmount)}`
              ) : resolvedSchedule === 'custom' ? (
                `Pay ${formatCurrency(calculatePaymentAmount())}`
              ) : financials.amountPastDue === 0 ? (
                "Set Up Auto-Pay"
              ) : (
                `Pay ${formatCurrency(calculatePaymentAmount())} & Set Up Auto-Pay`
              )}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </BowlerLayout>
  );
}