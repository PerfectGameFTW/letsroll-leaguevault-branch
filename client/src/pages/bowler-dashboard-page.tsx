import { useState, useRef, useEffect, FC } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useSquarePayment } from "@/hooks/use-square-payment";
import { createPayment } from "@/lib/square";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, ArrowRight, CreditCard, Calendar } from "lucide-react";
import { Link } from "wouter";
import { BowlerLayout } from "@/components/bowler-layout";
import { startOfToday, differenceInWeeks, format, addWeeks } from "date-fns";
import type { League, Payment, User, Bowler } from "@shared/schema";
import { useBowlers } from "@/hooks/use-bowlers";

type PaymentSchedule = "weekly" | "monthly" | "half" | "full";

interface PaymentOption {
  id: PaymentSchedule;
  label: string;
  description: string;
  calculateAmount: (weeklyFee: number, totalWeeks: number) => number;
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
    id: "half",
    label: "Half Season Payment",
    description: "Pay for half of the season upfront (with 5% discount)",
    calculateAmount: (weeklyFee, totalWeeks) => {
      const halfSeasonAmount = weeklyFee * Math.ceil(totalWeeks / 2);
      return Math.round(halfSeasonAmount * 0.95); // 5% discount
    },
  },
  {
    id: "full",
    label: "Full Season Payment",
    description: "Pay for the entire season upfront (with 10% discount)",
    calculateAmount: (weeklyFee, totalWeeks) => {
      const fullSeasonAmount = weeklyFee * totalWeeks;
      return Math.round(fullSeasonAmount * 0.90); // 10% discount
    },
  },
];

export const BowlerDashboardPage: FC = () => {
  const { toast } = useToast();
  const [showPaymentSetup, setShowPaymentSetup] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState<PaymentSchedule>("weekly");
  const cardContainerRef = useRef<HTMLDivElement>(null);

  // Initialize Square payment form with enhanced error handling and logging
  const { card, isInitialized, error: squareError, initializeCard } = useSquarePayment({
    onError: (error) => {
      console.error('[Square Payment Error]:', error);
      toast({
        title: "Payment Setup Error",
        description: error,
        variant: "destructive",
      });
    },
  });

  // Initialize card when payment setup is shown with detailed logging
  useEffect(() => {
    console.log('[BowlerDashboard] Payment setup state:', {
      showPaymentSetup,
      isInitialized,
      hasCardContainer: !!cardContainerRef.current,
      cardState: card ? 'exists' : 'null'
    });

    if (showPaymentSetup && cardContainerRef.current && !isInitialized) {
      console.log('[BowlerDashboard] Attempting to initialize Square payment form');
      try {
        initializeCard(cardContainerRef.current);
        console.log('[BowlerDashboard] Square payment form initialized successfully');
      } catch (error) {
        console.error('[BowlerDashboard] Error initializing payment form:', error);
        toast({
          title: "Payment Setup Error",
          description: "Failed to initialize payment form. Please try again.",
          variant: "destructive",
        });
      }
    }
  }, [showPaymentSetup, isInitialized, initializeCard, card]);

  // Cleanup effect - only destroy card when component unmounts
  useEffect(() => {
    return () => {
      if (card) {
        console.log('[BowlerDashboard] Cleaning up Square payment form');
        card.destroy();
      }
    };
  }, [card]);

  const { data: currentUserResponse, isLoading: isUserLoading } = useQuery<ApiResponse<User>>({
    queryKey: ["/api/user"],
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });

  const {
    bowlers,
    getBowlerTeamName,
    getBowlerFirstLeagueName,
    isInitialLoading,
    isLoadingRelatedData,
    getBowlerLeagueId,
    getWeeklyFee
  } = useBowlers({
    isEnabled: !!currentUserResponse?.data?.bowlerId,
  });

  const currentUser = currentUserResponse?.data;
  const bowler = currentUser?.bowlerId ? bowlers.find((b: Bowler) => b.id === currentUser.bowlerId) : null;
  const leagueId = bowler ? getBowlerLeagueId(bowler) : null;

  // Get league and payment data for status checks
  const { data: combinedData, isLoading: isCombinedLoading } = useQuery({
    queryKey: [`/api/dashboard-data`, leagueId],
    enabled: !!leagueId,
    queryFn: async () => {
      if (!leagueId) throw new Error('League ID is required');

      try {
        const [leagueRes, paymentsRes] = await Promise.all([
          fetch(`/api/leagues/${leagueId}`),
          fetch(`/api/payments?bowlerId=${bowler?.id}&leagueId=${leagueId}`)
        ]);

        if (!leagueRes.ok || !paymentsRes.ok) {
          throw new Error('Failed to fetch dashboard data');
        }

        const [leagueData, paymentsData] = await Promise.all([
          leagueRes.json(),
          paymentsRes.json()
        ]);

        return {
          league: leagueData.data,
          payments: paymentsData.data
        };
      } catch (error) {
        console.error('[BowlerDashboard] Data fetch error:', error);
        throw error;
      }
    },
    staleTime: 1000 * 60 * 5,
  });

  const league = combinedData?.league;
  const payments = combinedData?.payments || [];


  const calculatePaymentAmount = () => {
    if (!league || !bowler) return 0;

    const selectedOption = PAYMENT_OPTIONS.find(opt => opt.id === selectedSchedule);
    if (!selectedOption) return 0;

    const weeklyFee = getWeeklyFee(bowler);
    const totalWeeks = Math.ceil(
      (new Date(league.seasonEnd).getTime() - new Date(league.seasonStart).getTime()) /
      (7 * 24 * 60 * 60 * 1000)
    );

    return selectedOption.calculateAmount(weeklyFee, totalWeeks);
  };

  const handleSubmitPayment = async () => {
    if (!card || !league || !bowler) {
      toast({
        title: "Payment Setup Error",
        description: "Unable to process payment at this time. Please try again later.",
        variant: "destructive",
      });
      return;
    }

    try {
      const amount = calculatePaymentAmount();
      if (amount <= 0) {
        throw new Error("Invalid payment amount calculated");
      }

      const result = await createPayment(amount, card);

      if (result.status === 'COMPLETED') {
        toast({
          title: "Payment Setup Successful",
          description: `Your ${selectedSchedule} payment schedule has been set up successfully.`,
        });
        setShowPaymentSetup(false);
      } else {
        throw new Error("Payment was not completed successfully");
      }
    } catch (error) {
      console.error('[PaymentSetup] Payment error:', error);
      toast({
        title: "Payment Setup Failed",
        description: error instanceof Error ? error.message : "Failed to set up payment. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Calculate payment status and upcoming payments...
  const totalPaidAmount = payments
    .filter((p: Payment) => p.status === 'paid')
    .reduce((sum: number, p: Payment) => sum + p.amount, 0);

  let amountPastDue = 0;
  let upcomingPayments: UpcomingPayment[] = [];

  if (league?.seasonStart && league.seasonEnd && bowler) {
    const weeklyFee = getWeeklyFee(bowler);
    const seasonStart = new Date(league.seasonStart);
    const seasonEnd = new Date(league.seasonEnd);
    const today = startOfToday();

    const weeksDue = today < seasonStart ? 0 :
                     today > seasonEnd ? Math.max(0, differenceInWeeks(seasonEnd, seasonStart)) :
                     Math.max(0, differenceInWeeks(today, seasonStart));

    const totalSeasonDues = weeklyFee * weeksDue;
    amountPastDue = Math.max(0, totalSeasonDues - totalPaidAmount);

    // Calculate upcoming payments for the next 4 weeks
    if (bowler?.squareCustomerId) {
      const nextPaymentDate = addWeeks(today, 1);
      for (let i = 0; i < 4; i++) {
        const paymentDate = addWeeks(nextPaymentDate, i);
        if (paymentDate <= seasonEnd) {
          upcomingPayments.push({
            dueDate: paymentDate,
            amount: weeklyFee
          });
        }
      }
    }
  }

  if (isUserLoading || isInitialLoading || isLoadingRelatedData || isCombinedLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <Card className="mx-auto max-w-md mt-8">
        <CardHeader>
          <CardTitle>Authentication Required</CardTitle>
          <CardDescription>Please log in to view your dashboard</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            You need to be logged in to access your bowler dashboard.
          </p>
          <Link href="/login">
            <Button className="w-full">Log In</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (!bowler) {
    return (
      <Card className="mx-auto max-w-md mt-8">
        <CardHeader>
          <CardTitle>Profile Setup Required</CardTitle>
          <CardDescription>Your bowler profile needs to be configured</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Please contact a league administrator to set up your bowler profile.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <BowlerLayout
      bowlerName={bowler.name}
      leagueName={getBowlerFirstLeagueName(bowler)}
    >
      <div className="space-y-6">
        {/* Dashboard Overview Card */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-3xl font-bold">{bowler.name}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-0.5">
              <p className="text-lg">{getBowlerFirstLeagueName(bowler)}</p>
              <p className="text-base text-muted-foreground">{getBowlerTeamName(bowler)}</p>
            </div>
          </CardContent>
        </Card>

        {/* Payment Status Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Payment Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {!bowler?.squareCustomerId ? (
                showPaymentSetup ? (
                  <div className="space-y-6">
                    <div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Payment Schedule Selection */}
                        <div className="space-y-4">
                          <h3 className="text-lg font-semibold">Choose Payment Schedule</h3>
                          <RadioGroup
                            value={selectedSchedule}
                            onValueChange={(value) => {
                              console.log('[BowlerDashboard] Selected payment schedule:', value);
                              setSelectedSchedule(value as PaymentSchedule);
                            }}
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
                        </div>

                        {/* Card Input Form */}
                        <div className="space-y-4">
                          <h3 className="text-lg font-semibold">Payment Information</h3>
                          <div
                            ref={cardContainerRef}
                            className="min-h-[250px] p-4 border rounded-lg bg-card"
                            style={{ minHeight: '250px' }}
                          />
                          {squareError && (
                            <p className="text-sm text-destructive">{squareError}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2 pt-4 border-t">
                      <Button
                        variant="outline"
                        onClick={() => {
                          console.log('[BowlerDashboard] Canceling payment setup');
                          setShowPaymentSetup(false);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleSubmitPayment}
                        disabled={!isInitialized || !!squareError}
                      >
                        Set Up Payment Schedule
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 pt-2">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <CreditCard className="h-5 w-5" />
                      <p>Set up your payment method to enable automatic payments</p>
                    </div>
                    <div className="rounded-md bg-secondary/50 p-4">
                      <h3 className="font-semibold mb-2">Why set up automatic payments?</h3>
                      <ul className="space-y-2 text-sm text-muted-foreground">
                        <li>• Never miss a payment deadline</li>
                        <li>• Choose flexible payment schedules</li>
                        <li>• Secure and hassle-free transactions</li>
                        <li>• Special discounts for full season payments</li>
                      </ul>
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => setShowPaymentSetup(true)}
                    >
                      Set Up Payments Now
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                )
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <h3 className="text-lg font-semibold">Payment Method</h3>
                      <p className="text-sm text-muted-foreground">
                        Your automatic payments are configured
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => setShowPaymentSetup(true)}
                    >
                      Update Payment Settings
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>

                  {upcomingPayments.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-lg font-semibold">Upcoming Payments</h3>
                      <div className="space-y-2">
                        {upcomingPayments.map((payment, index) => (
                          <div
                            key={index}
                            className="flex items-center justify-between p-3 rounded-lg border bg-card"
                          >
                            <div className="flex items-center gap-3">
                              <Calendar className="h-5 w-5 text-muted-foreground" />
                              <div>
                                <p className="font-medium">
                                  {format(payment.dueDate, 'MMMM d, yyyy')}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  Automatic payment scheduled
                                </p>
                              </div>
                            </div>
                            <p className="font-semibold">
                              ${(payment.amount / 100).toFixed(2)}
                            </p>
                          </div>
                        ))}
                      </div>
                      <Link href="/payment-history">
                        <Button variant="link" className="p-0">
                          View full payment history
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  )}

                  {amountPastDue > 0 && (
                    <div className="rounded-md bg-destructive/10 p-4">
                      <div className="flex items-start">
                        <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
                        <div className="ml-3">
                          <h3 className="text-sm font-medium text-destructive">Payment Past Due</h3>
                          <div className="mt-1 text-sm text-destructive">
                            <p>You have an outstanding balance of ${(amountPastDue / 100).toFixed(2)}.</p>
                            <p className="mt-2">Please make a payment to maintain your active status in the league.</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </BowlerLayout>
  );
};

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    message: string;
    code?: string;
  };
}

interface UpcomingPayment {
  dueDate: Date;
  amount: number;
}

export default BowlerDashboardPage;