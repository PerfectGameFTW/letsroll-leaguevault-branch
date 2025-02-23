import { useState, useRef, useEffect, FC, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertPaymentScheduleSchema, type Payment, type League, type User, type Bowler } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useSquarePayment } from "@/hooks/use-square-payment";
import { createPayment } from "@/lib/square";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Drawer as DrawerPrimitive } from "vaul";
import { Loader2, AlertCircle, ArrowRight, CreditCard, Calendar, Plus, Minus } from "lucide-react";
import { Link } from "wouter";
import { BowlerLayout } from "@/components/bowler-layout";
import { startOfToday, differenceInWeeks, format, addWeeks } from "date-fns";
import { useBowlers } from "@/hooks/use-bowlers";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Add these type definitions before the component
interface ModifyScheduleFormData {
  frequency: "weekly" | "monthly";
  amount: number;
}

// Update the PaymentSchedule type definition
type PaymentSchedule = "weekly" | "monthly" | "custom";


const DEBUG_HOOKS = true;

function getPaymentFrequency(payments: Payment[] = []): "weekly" | "monthly" {
  if (!payments?.length) return 'weekly';

  const recentPayments = payments.slice(0, 2);
  if (recentPayments.length < 2) return 'weekly';

  const weeks = differenceInWeeks(
    new Date(recentPayments[0].weekOf),
    new Date(recentPayments[1].weekOf)
  );

  return weeks >= 4 ? 'monthly' : 'weekly';
}

function usePaymentDrawer() {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedWeeks, setSelectedWeeks] = useState<number>(1);

  const handleWeekChange = useCallback((weeks: number, totalWeeks: number) => {
    if (totalWeeks === 0) return;
    const validWeeks = Math.min(Math.max(1, weeks), totalWeeks);
    setSelectedWeeks(validWeeks);
  }, []);

  return {
    isDrawerOpen,
    setIsDrawerOpen,
    selectedWeeks,
    handleWeekChange
  };
}

const Drawer = DrawerPrimitive as {
  Root: typeof DrawerPrimitive.Root;
  Portal: typeof DrawerPrimitive.Portal;
  Overlay: typeof DrawerPrimitive.Overlay;
  Content: typeof DrawerPrimitive.Content;
};

interface PaymentOption {
  id: PaymentSchedule;
  label: string;
  description: string;
  calculateAmount: (weeklyFee: number, totalWeeks: number, customWeeks?: number) => number;
}
interface UpcomingPayment {
  dueDate: Date;
  amount: number;
}
interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    message: string;
    code?: string;
  };
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

const getSeasonLength = (currentLeague?: League | null) => {
  if (!currentLeague?.seasonStart || !currentLeague?.seasonEnd) return 0;
  return Math.ceil(
    (new Date(currentLeague.seasonEnd).getTime() - new Date(currentLeague.seasonStart).getTime()) /
      (7 * 24 * 60 * 60 * 1000)
  );
};


export const BowlerDashboardPage: FC = () => {
  if (DEBUG_HOOKS) {
    console.log('[BowlerDashboard] Component rendering start'); // Debug log
  }

  const { toast } = useToast();
  const cardContainerRef = useRef<HTMLDivElement>(null);
  const [showPaymentSetup, setShowPaymentSetup] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState<PaymentSchedule>("weekly");
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  const { isDrawerOpen, setIsDrawerOpen, selectedWeeks, handleWeekChange: customHandleWeekChange } = usePaymentDrawer();

  const { data: currentUserResponse } = useQuery<ApiResponse<User>>({
    queryKey: ["/api/user"],
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });

  const currentUser = currentUserResponse?.data;

  const {
    bowlers,
    getBowlerTeamName,
    getBowlerFirstLeagueName,
    isInitialLoading,
    isLoadingRelatedData,
    getBowlerLeagueId,
    getWeeklyFee,
  } = useBowlers({
    isEnabled: !!currentUser?.bowlerId,
  });

  const bowler = useMemo(() =>
    currentUser?.bowlerId ? bowlers.find((b: Bowler) => b.id === currentUser.bowlerId) : null,
    [currentUser?.bowlerId, bowlers]
  );

  const leagueId = useMemo(() =>
    bowler ? getBowlerLeagueId(bowler) : null,
    [bowler, getBowlerLeagueId]
  );

  // Add payment schedule query at component level
  const { data: paymentScheduleResponse, isLoading: isPaymentScheduleLoading } = useQuery({
    queryKey: [`/api/payment-schedules`, bowler?.id],
    enabled: !!bowler?.id && !!leagueId,
    queryFn: async () => {
      const response = await fetch(`/api/payment-schedules?bowlerId=${bowler?.id}&leagueId=${leagueId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch payment schedule');
      }
      return response.json();
    },
  });

  const { data: combinedData, isLoading: isCombinedLoading } = useQuery({
    queryKey: [`/api/dashboard-data`, leagueId],
    enabled: !!leagueId,
    queryFn: async () => {
      if (!leagueId) throw new Error('League ID is required');

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
    },
    staleTime: 1000 * 60 * 5,
  });

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

  const league = combinedData?.league;
  const payments = combinedData?.payments || [];
  const totalWeeks = useMemo(() => getSeasonLength(league), [league]);
  const weeklyFee = useMemo(() => bowler ? getWeeklyFee(bowler) : 0, [bowler, getWeeklyFee]);

  const totalPaidAmount = useMemo(() =>
    payments
      .filter((p: Payment) => p.status === 'paid')
      .reduce((sum: number, p: Payment) => sum + p.amount, 0),
    [payments]
  );

  const upcomingPayments = useMemo(() => {
    if (!league?.seasonStart || !league?.seasonEnd || !weeklyFee) return [];

    const seasonEnd = new Date(league.seasonEnd);
    const today = startOfToday();
    const nextPaymentDate = addWeeks(today, 1);
    const payments: UpcomingPayment[] = [];
    const frequency = getPaymentFrequency(payments);
    const weeksPerPayment = frequency === 'monthly' ? 4 : 1;
    const paymentAmount = frequency === 'monthly' ? weeklyFee * 4 : weeklyFee;

    for (let i = 0; i < 4; i++) {
      const paymentDate = addWeeks(nextPaymentDate, i * weeksPerPayment);
      if (paymentDate <= seasonEnd) {
        payments.push({
          dueDate: paymentDate,
          amount: paymentAmount
        });
      }
    }

    return payments;
  }, [league, weeklyFee, payments]);

  const amountPastDue = useMemo(() => {
    if (!league?.seasonStart || !league?.seasonEnd || !weeklyFee) return 0;

    const seasonStart = new Date(league.seasonStart);
    const seasonEnd = new Date(league.seasonEnd);
    const today = startOfToday();

    const weeksDue = today < seasonStart ? 0 :
      today > seasonEnd ? Math.max(0, differenceInWeeks(seasonEnd, seasonStart)) :
        Math.max(0, differenceInWeeks(today, seasonStart));

    const totalSeasonDues = weeklyFee * weeksDue;
    return Math.max(0, totalSeasonDues - totalPaidAmount);
  }, [league, weeklyFee, totalPaidAmount]);

  const handleWeekChangeWrapper = useCallback((weeks: number) => {
    if (!totalWeeks) return; // Add null check
    customHandleWeekChange(weeks, totalWeeks);
  }, [customHandleWeekChange, totalWeeks]);

  const calculateTotalAmount = useCallback(() => {
    if (!league || !bowler) return 0;

    const selectedOption = PAYMENT_OPTIONS.find(opt => opt.id === selectedSchedule);
    if (!selectedOption) return 0;

    return selectedOption.id === 'custom'
      ? selectedOption.calculateAmount(weeklyFee, totalWeeks, selectedWeeks)
      : selectedOption.calculateAmount(weeklyFee, totalWeeks);
  }, [league, bowler, selectedSchedule, weeklyFee, totalWeeks, selectedWeeks]);

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
      const amount = calculateTotalAmount();
      if (amount <= 0) {
        throw new Error("Invalid payment amount calculated");
      }

      const result = await createPayment(amount, card, bowler.id, league.id);

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
      console.error('[BowlerDashboard] Payment error:', error);
      toast({
        title: "Payment Setup Failed",
        description: error instanceof Error ? error.message : "Failed to set up payment. Please try again.",
        variant: "destructive",
      });
    }
  };

  const incrementWeeks = () => {
    handleWeekChangeWrapper(selectedWeeks + 1);
  };

  const decrementWeeks = () => {
    handleWeekChangeWrapper(selectedWeeks - 1);
  };

  // Define seasonPresets here, outside of the memo
  const seasonPresets = useMemo(() => [
    { label: "Quarter Season", weeks: Math.ceil(totalWeeks / 4) },
    { label: "Half Season", weeks: Math.ceil(totalWeeks / 2) },
    { label: "Full Season", weeks: totalWeeks }
  ], [totalWeeks]);

  const queryClient = useQueryClient();

  const cancelPaymentsMutation = useMutation({
    mutationFn: async () => {
      if (!bowler?.id || !leagueId) {
        throw new Error("Missing bowler or league information");
      }

      const response = await fetch(`/api/payment-schedules/${paymentScheduleResponse?.data?.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to cancel automatic payments');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/payment-schedules'] });
      toast({
        title: "Automatic Payments Cancelled",
        description: "Your automatic payment schedule has been cancelled. You can set up a new payment schedule at any time.",
      });
      setShowPaymentSetup(true);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleCancelPayments = async () => {
    try {
      await cancelPaymentsMutation.mutateAsync();
    } catch (error) {
      console.error('[BowlerDashboard] Cancel payments error:', error);
    } finally {
      setShowCancelDialog(false);
    }
  };


  useEffect(() => {
    if (showPaymentSetup && cardContainerRef.current && !isInitialized) {
      initializeCard(cardContainerRef.current);
    }
  }, [showPaymentSetup, isInitialized, initializeCard]);

  useEffect(() => {
    if (DEBUG_HOOKS) {
      console.log('[BowlerDashboard] Component mounted'); // Debug log
    }
    return () => {
      if (DEBUG_HOOKS) {
        console.log('[BowlerDashboard] Component unmounted'); // Debug log
      }
      if (card) {
        card.destroy();
      }
    };
  }, [card]);


  const renderPaymentStatus = useMemo(() => {
    console.log('[renderPaymentStatus] Payment schedule response:', paymentScheduleResponse);

    // Render loading state for payment schedule
    if (isPaymentScheduleLoading) {
      return (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      );
    }

    // Handle cases where bowler or league data is missing or incomplete.
    if (!bowler || !league) {
      return <p className="text-muted-foreground">No bowler or league data found.</p>;
    }

    return (
      <>
        {bowler?.squareCustomerId ? (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Payment Status</CardTitle>
                <CardDescription>Your automatic payment configuration</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <Card className="bg-secondary/10">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg">Automatic Payment Schedule</CardTitle>
                      <CardDescription>
                        Your league dues are automatically charged according to your selected schedule
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-4">
                        <div className="flex items-center justify-between">
                          <div className="space-y-1">
                            <p className="text-sm font-medium">Payment Frequency</p>
                            <p className="text-sm text-muted-foreground">
                              {getPaymentFrequency(payments) === 'weekly' ? 'Weekly Payments' : 'Monthly Payments (every 4 weeks)'}
                            </p>
                          </div>
                          <Badge variant="outline">
                            {getPaymentFrequency(payments) === 'weekly' ? 'Weekly' : 'Monthly'}
                          </Badge>
                        </div>

                        {payments?.length > 0 && (
                          <div className="flex items-center justify-between">
                            <div className="space-y-1">
                              <p className="text-sm font-medium">Last Payment</p>
                              <p className="text-sm text-muted-foreground">
                                {format(new Date(payments[0].weekOf), "MMMM d, yyyy")}
                              </p>
                            </div>
                            <p className="font-medium">${(payments[0].amount / 100).toFixed(2)}</p>
                          </div>
                        )}
                        {upcomingPayments.length > 0 && (
                          <div className="flex items-center justify-between">
                            <div className="space-y-1">
                              <p className="text-sm font-medium">Next Payment</p>
                              <p className="text-sm text-muted-foreground">
                                {format(upcomingPayments[0].dueDate, "MMMM d, yyyy")}
                              </p>
                            </div>
                            <p className="font-medium">
                              ${(upcomingPayments[0].amount / 100).toFixed(2)}
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 pt-4 border-t">
                        <Button
                          variant="destructive"
                          onClick={() => setShowCancelDialog(true)}
                          className="w-full"
                        >
                          Cancel Automatic Payments
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Cancel Automatic Payments?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will stop all future automatic payments for your league dues. You can set up a new payment schedule at any time.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep Current Schedule</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleCancelPayments}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Yes, Cancel Payments
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>

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
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
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
        ) : (
          showPaymentSetup ? (
            <div className="space-y-6">
              <div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                      {PAYMENT_OPTIONS.map((option) => {
                        const amount = option.id === 'custom'
                          ? option.calculateAmount(weeklyFee, totalWeeks, selectedWeeks)
                          : option.calculateAmount(weeklyFee, totalWeeks);

                        return (
                          <div key={option.id} className="flex items-center space-x-2">
                            <RadioGroupItem value={option.id} id={option.id} />
                            <Label htmlFor={option.id} className="flex flex-col">
                              <span className="font-medium">{option.label}</span>
                              <span className="text-sm text-muted-foreground">
                                {option.description}
                              </span>
                              <span className="text-sm font-semibold">
                                ${(amount / 100).toFixed(2)}
                              </span>
                            </Label>
                          </div>
                        );
                      })}
                    </RadioGroup>

                    {selectedSchedule === 'custom' && (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => setIsDrawerOpen(true)}
                          className="w-full mt-4"
                        >
                          Select Number of Weeks
                        </Button>

                        <Drawer.Root
                          open={isDrawerOpen}
                          onOpenChange={setIsDrawerOpen}
                        >
                          <Drawer.Portal>
                            <Drawer.Overlay className="fixed inset-0 bg-black/40" />
                            <Drawer.Content className="bg-background flex flex-col fixed bottom-0 left-0 right-0 max-h-[85vh] rounded-t-[10px]">
                              <div className="p-4 bg-muted/40 rounded-t-[10px] flex-1">
                                <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-muted mb-8" />

                                <div className="max-w-md mx-auto">
                                  <h3 className="font-semibold mb-4">Select Number of Weeks</h3>

                                  <div className="grid grid-cols-3 gap-4 mb-6">
                                    {seasonPresets.map(preset => (
                                      <Button
                                        key={preset.label}
                                        variant={selectedWeeks === preset.weeks ? "default" : "outline"}
                                        onClick={() => handleWeekChangeWrapper(preset.weeks)}
                                        className="w-full"
                                        disabled={!league || preset.weeks === 0}
                                      >
                                        {preset.label}
                                      </Button>
                                    ))}
                                  </div>

                                  <div className="flex items-center space-x-4 mb-6">
                                    <Button
                                      variant="outline"
                                      size="icon"
                                      onClick={decrementWeeks}
                                      disabled={selectedWeeks <= 1}
                                    >
                                      <Minus className="h-4 w-4" />
                                    </Button>

                                    <div className="flex-1">
                                      <Input
                                        type="number"
                                        value={selectedWeeks}
                                        onChange={(e) => handleWeekChangeWrapper(parseInt(e.target.value) || 1)}
                                        min={1}
                                        max={totalWeeks}
                                        className="text-center"
                                      />
                                    </div>

                                    <Button
                                      variant="outline"
                                      size="icon"
                                      onClick={incrementWeeks}
                                      disabled={selectedWeeks >= totalWeeks}
                                    >
                                      <Plus className="h-4 w-4" />
                                    </Button>
                                  </div>

                                  <div className="rounded-lg border bg-card p-4">
                                    <div className="flex justify-between items-center mb-2">
                                      <span className="text-sm text-muted-foreground">Weekly Fee</span>
                                      <span>${(weeklyFee / 100).toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between items-center mb-2">
                                      <span className="text-sm text-muted-foreground">Number of Weeks</span>
                                      <span>{selectedWeeks}</span>
                                    </div>
                                    <div className="flex justify-between items-center pt-2 border-t">
                                      <span className="font-semibold">Total Amount</span>
                                      <span className="text-lg font-bold">
                                        ${(calculateTotalAmount() / 100).toFixed(2)}
                                      </span>
                                    </div>
                                  </div>

                                  <Button
                                    className="w-full mt-6"
                                    onClick={() => setIsDrawerOpen(false)}
                                  >
                                    Confirm Selection
                                  </Button>
                                </div>
                              </div>
                            </Drawer.Content>
                          </Drawer.Portal>
                        </Drawer.Root>
                      </>
                    )}

                    <div className="mt-6 p-4 rounded-lg border bg-secondary/50">
                      <div className="flex justify-between items-center">
                        <span className="font-semibold">Total Amount:</span>
                        <span className="text-lg font-bold">
                          ${(calculateTotalAmount() / 100).toFixed(2)}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-2">
                        {selectedSchedule === 'weekly' && 'Billed weekly'}
                        {selectedSchedule === 'monthly' && 'Billed monthly (every 4 weeks)'}
                        {selectedSchedule === 'custom' && `One-time payment for ${selectedWeeks} week${selectedWeeks > 1 ? 's' : ''}`}
                      </p>
                    </div>
                  </div>

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
            <div className="text-center">
              <Button
                onClick={() => setShowPaymentSetup(true)}
                className="w-full md:w-auto"
              >
                Set Up Automatic Payments
              </Button>
            </div>
          )
        )}
      </>
    );
  }, [
    isPaymentScheduleLoading,
    bowler,
    league,
    payments,
    upcomingPayments,
    amountPastDue,
    showPaymentSetup,
    showCancelDialog,
    handleCancelPayments,
  ]);

  if (!currentUser) {
    return (
      <Card className="mx-auto max-w-md mt-8">
        <CardHeader>
          <CardTitle>Authentication Required</CardTitle>
          <CardDescription>Please log in to view your dashboard</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="textmuted-foreground">
            You must be logged in to access your bowler dashboard.
          </p>
          <Link href="/auth">
            <Button className="w-full">
              Log In
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (isInitialLoading || isLoadingRelatedData || isCombinedLoading || isPaymentScheduleLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!bowler || !league) {
    return (
      <Card className="mx-auto max-w-md mt-8">
        <CardHeader>
          <CardTitle>Profile or League Data Missing</CardTitle>
          <CardDescription>Unable to load your bowler profile or league information</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Please ensure you have an active bowler profile and are assigned to a league.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <BowlerLayout
      bowler={bowler}
      team={getBowlerTeamName(bowler)}
      league={getBowlerFirstLeagueName(bowler)}
    >
      <div className="container py-6 space-y-6">
        <div className="flex flex-col space-y-1.5">
          <h2 className="text-2xl font-semibold tracking-tight">Payment Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            Manage your league payments and automatic payment schedule
          </p>
        </div>
        {renderPaymentStatus}
      </div>
    </BowlerLayout>
  );
};

export default BowlerDashboardPage;