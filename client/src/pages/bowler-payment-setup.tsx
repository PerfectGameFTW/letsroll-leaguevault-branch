import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
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
import { Loader2, AlertCircle, AlertTriangle, CreditCard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSquarePayment } from "@/hooks/use-square-payment";
import { createPayment } from "@/lib/square";
import { useParams, useLocation } from "wouter";
import type { League, BowlerLeague, Payment } from "@shared/schema";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getSeasonLengthWeeks, calculateFinancials } from "@/lib/financial-utils";
import { formatCurrency } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";

type PaymentSchedule = "weekly" | "monthly" | "custom";

interface PaymentOption {
  id: PaymentSchedule;
  label: string;
  description: string;
  calculateAmount: (weeklyFee: number, totalWeeks: number, customWeeks?: number) => number;
}

const PAYMENT_OPTIONS: PaymentOption[] = [
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

export default function BowlerPaymentSetupPage() {
  const params = useParams();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const bowlerId = parseInt(params.bowlerId!);
  const [selectedSchedule, setSelectedSchedule] = useState<PaymentSchedule>("weekly");
  const cardContainerRef = useRef<HTMLDivElement>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [customWeeks, setCustomWeeks] = useState(1);
  const [includeFinalTwoWeeks, setIncludeFinalTwoWeeks] = useState(false);
  const [showFinalTwoWeeksWarning, setShowFinalTwoWeeksWarning] = useState(false);

  const { card, isInitialized, error: squareError, initializeCard } = useSquarePayment({
    onError: (error) => {
      console.error('[BowlerPaymentSetup] Square initialization error:', error);
      toast({
        title: "Payment Setup Error",
        description: error,
        variant: "destructive",
      });
    },
  });

  const { data: bowlerLeaguesResponse } = useQuery<{ data: BowlerLeague[] }>({
    queryKey: ["/api/bowler-leagues", bowlerId],
    enabled: !!bowlerId,
  });
  const bowlerLeagues = bowlerLeaguesResponse?.data || [];

  const { data: leagueResponse } = useQuery<{ data: League }>({
    queryKey: ["/api/leagues", bowlerLeagues[0]?.leagueId],
    enabled: !!bowlerLeagues.length,
  });
  const league = leagueResponse?.data;

  const { data: paymentsResponse } = useQuery<{ data: Payment[] }>({
    queryKey: ["/api/payments"],
  });
  const bowlerPayments = (paymentsResponse?.data || []).filter(
    p => p.bowlerId === bowlerId && league && p.leagueId === league.id
  );
  const financials = calculateFinancials(league || null, bowlerPayments);

  useEffect(() => {
    if (cardContainerRef.current && !isInitialized) {
      initializeCard(cardContainerRef.current);
    }
  }, [isInitialized, initializeCard]);

  const calculatePaymentAmount = () => {
    if (!league) return 0;

    const selectedOption = PAYMENT_OPTIONS.find(opt => opt.id === selectedSchedule);
    if (!selectedOption) return 0;

    const totalWeeks = getSeasonLengthWeeks(league);

    let amount = selectedOption.calculateAmount(league.weeklyFee, totalWeeks, customWeeks);
    if (includeFinalTwoWeeks) {
      amount += league.weeklyFee * 2;
    }
    return amount;
  };

  const handleSubmit = async () => {
    if (!card || !league) {
      toast({
        title: "Payment Setup Error",
        description: "Unable to process payment at this time. Please try again later.",
        variant: "destructive",
      });
      return;
    }

    const isAutoPay = selectedSchedule !== 'custom';
    const finalTwoWeeksUnpaid = !financials.finalTwoWeeks.isPaid && financials.finalTwoWeeks.amount > 0;

    if (isAutoPay && finalTwoWeeksUnpaid && !includeFinalTwoWeeks && !showFinalTwoWeeksWarning) {
      setShowFinalTwoWeeksWarning(true);
      return;
    }

    try {
      setPaymentError(null);
      setIsProcessing(true);
      setShowFinalTwoWeeksWarning(false);

      const amount = calculatePaymentAmount();
      if (amount <= 0) {
        throw new Error("Invalid payment amount calculated");
      }

      // Process payment and set up recurring schedule if needed
      if (selectedSchedule !== "custom") {
        // Create payment schedule
        const scheduleAmount = includeFinalTwoWeeks
          ? amount - league.weeklyFee * 2
          : amount;
        const scheduleResponse = await fetch("/api/payment-schedules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bowlerId,
            leagueId: league.id,
            frequency: selectedSchedule,
            amount: scheduleAmount,
            nextPaymentDate: new Date(),
            squareCardId: card.id,
            includeFinalTwoWeeks,
          }),
        });

        if (!scheduleResponse.ok) {
          throw new Error("Failed to set up payment schedule");
        }
      }

      // Process the initial payment
      const paymentResult = await createPayment(amount, card, bowlerId, league.id);

      toast({
        title: "Payment Successful",
        description: selectedSchedule === "custom"
          ? "Your one-time payment has been processed successfully."
          : `Your ${selectedSchedule} payment schedule has been set up successfully.`,
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
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold">Set Up League Payments</h1>
          <p className="text-muted-foreground">
            Choose your preferred payment schedule for {league.name}
          </p>
        </div>

        {paymentError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{paymentError}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Payment Schedule</CardTitle>
            <CardDescription>
              Select how you would like to pay your league dues
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={selectedSchedule}
              onValueChange={(value) => setSelectedSchedule(value as PaymentSchedule)}
              className="space-y-4"
            >
              {PAYMENT_OPTIONS.map((option) => (
                <div key={option.id} className="flex items-center space-x-2">
                  <RadioGroupItem value={option.id} id={option.id} />
                  <Label htmlFor={option.id} className="flex flex-col">
                    <span className="font-medium">{option.label}</span>
                    <span className="text-sm text-muted-foreground">
                      {option.description}
                    </span>
                    <span className="text-sm font-semibold">
                      ${(calculatePaymentAmount() / 100).toFixed(2)}
                    </span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </CardContent>
        </Card>

        {!financials.finalTwoWeeks.isPaid && financials.finalTwoWeeks.amount > 0 && (
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
                    Include Final 2 Weeks (${(financials.finalTwoWeeks.amount / 100).toFixed(2)})
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Pay the final 2 weeks upfront with your first payment. Due by Week {financials.finalTwoWeeks.dueByWeek}.
                    {selectedSchedule !== 'custom' && ' Your auto-pay schedule will be reduced by 2 weeks.'}
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
              Enter your card details to set up automatic payments
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
            {squareError && (
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
              disabled={!isInitialized || !!squareError || isProcessing}
              className="w-full"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing Payment...
                </>
              ) : (
                "Set Up Payment Schedule"
              )}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </Layout>
  );
}