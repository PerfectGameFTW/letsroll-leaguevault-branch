import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import type { League, Payment } from "@shared/schema";
import { BowlerLayout } from "@/components/bowler-layout";
import { Loader2, ArrowLeft, CreditCard, Wallet } from "lucide-react";
import { Link } from "wouter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { differenceInWeeks, startOfToday, format, addWeeks } from "date-fns";
import { useSquarePayment } from "@/hooks/use-square-payment";
import { createPayment } from "@/lib/square";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface SavedCard {
  id: string;
  last4: string;
  brand: string;
  expMonth: number;
  expYear: number;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    message: string;
    code?: string;
  };
}

interface User {
  id: number;
  bowlerId: number | null;
  name: string | null;
  email: string;
  isAdmin: boolean;
  isOrganizationAdmin: boolean;
}

export default function PaymentHistoryPage() {
  const { toast } = useToast();
  const [payDialogType, setPayDialogType] = useState<'pastdue' | 'remaining' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cardMode, setCardMode] = useState<'new' | 'saved'>('new');
  const [selectedSavedCardId, setSelectedSavedCardId] = useState<string>('');
  const [storeCard, setStoreCard] = useState(false);
  const { card, isInitialized, initializeCard, cleanupCard } = useSquarePayment({
    onError: (error) => {
      console.error('[Square Payment Error]:', error);
      toast({ title: "Payment Setup Error", description: error, variant: "destructive" });
    }
  });

  const cardCallbackRef = useRef<(el: HTMLDivElement | null) => void>(() => {});
  cardCallbackRef.current = (el: HTMLDivElement | null) => {
    if (el && payDialogType && cardMode === 'new') {
      initializeCard(el);
    }
  };

  useEffect(() => {
    if (!payDialogType) {
      cleanupCard();
    }
  }, [payDialogType]);

  // Get current user and their bowler ID
  const { data: currentUser, isLoading: loadingUser, error: userError } = useQuery<ApiResponse<User>>({
    queryKey: ["/api/user"],
  });

  const bowlerId = currentUser?.data?.bowlerId;

  const { data: savedCardsResponse } = useQuery<ApiResponse<SavedCard[]>>({
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

  // Get bowler details
  const { data: bowlerResponse, isLoading: loadingBowler, error: bowlerError } = useQuery<ApiResponse<{ name: string }>>({
    queryKey: [`/api/bowlers/${bowlerId}`],
    enabled: !!bowlerId,
  });

  // Get league information for the bowler
  const { data: bowlerLeaguesResponse, isLoading: loadingBowlerLeagues, error: bowlerLeaguesError } = useQuery<ApiResponse<{ leagueId: number }[]>>({
    queryKey: ["/api/bowler-leagues", bowlerId],
    enabled: !!bowlerId,
  });

  // Find the first active league for the bowler
  const leagueId = bowlerLeaguesResponse?.data?.[0]?.leagueId;

  // Get league details
  const { data: leagueResponse, isLoading: loadingLeague } = useQuery<ApiResponse<League>>({
    queryKey: [`/api/leagues/${leagueId}`],
    enabled: !!leagueId,
  });

  // Get payment history
  const { data: paymentsResponse, isLoading: loadingPayments } = useQuery<ApiResponse<Payment[]>>({
    queryKey: ["/api/payments", bowlerId, leagueId],
    enabled: !!bowlerId && !!leagueId,
  });

  const league = leagueResponse?.data;
  const payments = paymentsResponse?.data || [];
  const bowlerName = bowlerResponse?.data?.name || '';

  // Filter to only this bowler's payments for this league
  const bowlerPayments = payments.filter(p => p.bowlerId === bowlerId && p.leagueId === leagueId);
  const totalPaidPayments = bowlerPayments.filter(p => p.status === 'paid');
  const totalPaidAmount = totalPaidPayments.reduce((sum, p) => sum + p.amount, 0);

  let weeksDue = 0;
  let totalSeasonDues = 0;
  let totalWeeksInSeason = 0;
  let fullSeasonAmount = 0;
  let amountPastDue = 0;
  let remainingBalance = 0;

  if (league?.seasonStart && league.seasonEnd && league.weeklyFee) {
    const seasonStart = new Date(league.seasonStart);
    const seasonEnd = new Date(league.seasonEnd);
    const today = startOfToday();

    if (today < seasonStart) {
      weeksDue = 0;
    } else if (today > seasonEnd) {
      weeksDue = Math.max(0, differenceInWeeks(seasonEnd, seasonStart));
    } else {
      weeksDue = Math.max(0, differenceInWeeks(today, seasonStart));
    }

    totalSeasonDues = league.weeklyFee * weeksDue;
    totalWeeksInSeason = differenceInWeeks(seasonEnd, seasonStart);
    fullSeasonAmount = league.weeklyFee * totalWeeksInSeason;
    amountPastDue = Math.max(0, totalSeasonDues - totalPaidAmount);
    remainingBalance = fullSeasonAmount - totalPaidAmount;
  }

  let finalTwoWeeksAmount = 0;
  let finalTwoWeeksDueByWeek = 6;
  let finalTwoWeeksDueByDate: Date | null = null;
  let finalTwoWeeksIsPaid = false;
  let finalTwoWeeksIsPastDue = false;
  let finalTwoWeeksPaidOnWeek: number | null = null;

  if (league?.weeklyFee && league?.seasonStart) {
    finalTwoWeeksDueByWeek = league.finalTwoWeeksDueWeek ?? 6;
    finalTwoWeeksAmount = league.weeklyFee * 2;
    finalTwoWeeksDueByDate = addWeeks(new Date(league.seasonStart), finalTwoWeeksDueByWeek);
    finalTwoWeeksIsPaid = totalPaidAmount >= finalTwoWeeksAmount;
    finalTwoWeeksIsPastDue = !finalTwoWeeksIsPaid && startOfToday() > finalTwoWeeksDueByDate;

    if (finalTwoWeeksIsPaid) {
      const seasonStart = new Date(league.seasonStart);
      const sortedPayments = [...totalPaidPayments].sort(
        (a, b) => new Date(a.weekOf).getTime() - new Date(b.weekOf).getTime()
      );
      let runningTotal = 0;
      for (const p of sortedPayments) {
        runningTotal += p.amount;
        if (runningTotal >= finalTwoWeeksAmount) {
          finalTwoWeeksPaidOnWeek = Math.max(1, differenceInWeeks(new Date(p.weekOf), seasonStart) + 1);
          break;
        }
      }
    }
  }

  const dialogAmount = payDialogType === 'pastdue' ? amountPastDue : remainingBalance;
  const dialogLabel = payDialogType === 'pastdue' ? 'past due amount' : 'remaining balance';

  const handleDialogPayment = async () => {
    if (!bowlerId || !leagueId || !dialogAmount) {
      toast({ title: "Error", description: "Missing payment information.", variant: "destructive" });
      return;
    }

    if (cardMode === 'new' && !card) {
      toast({ title: "Error", description: "Please enter your card details.", variant: "destructive" });
      return;
    }

    if (cardMode === 'saved' && !selectedSavedCardId) {
      toast({ title: "Error", description: "Please select a saved card.", variant: "destructive" });
      return;
    }

    try {
      setIsSubmitting(true);

      if (cardMode === 'saved' && selectedSavedCardId) {
        const response = await fetch('/api/square/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceId: selectedSavedCardId,
            amount: dialogAmount,
            bowlerId,
            leagueId,
            storeCard: false,
          }),
        });
        const responseData = await response.json();
        if (!response.ok) {
          throw new Error(responseData.error?.message || 'Payment failed');
        }
      } else {
        await createPayment(dialogAmount, card, bowlerId, leagueId, storeCard);
        if (storeCard) {
          queryClient.invalidateQueries({ queryKey: [`/api/square/cards/${bowlerId}`] });
        }
      }

      toast({ title: "Payment Successful", description: `$${(dialogAmount / 100).toFixed(2)} ${dialogLabel} has been paid.` });
      setPayDialogType(null);
      queryClient.invalidateQueries({ queryKey: ["/api/payments", bowlerId, leagueId] });
    } catch (error) {
      console.error('[Payment Error]:', error);
      toast({ title: "Payment Failed", description: error instanceof Error ? error.message : "Unable to process payment. Please try again.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loadingUser || loadingBowler || loadingBowlerLeagues || loadingLeague || loadingPayments) {
    return (
      <BowlerLayout bowlerName={bowlerName || 'Loading...'} leagueName={league?.name || 'Loading...'}>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </BowlerLayout>
    );
  }

  // Show error if user is not authenticated
  if (userError) {
    return (
      <BowlerLayout bowlerName="Authentication Error" leagueName="Error">
        <div className="text-center space-y-4">
          <p className="text-destructive">Please log in to view payment history</p>
          <Link href="/login" className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-white">
            Log In
          </Link>
        </div>
      </BowlerLayout>
    );
  }
  
  // Show message if user has no associated bowler
  if (currentUser?.data && !currentUser.data.bowlerId) {
    return (
      <BowlerLayout bowlerName={currentUser.data.name || "Administrator"} leagueName="No Bowler Account">
        <div className="text-center space-y-4">
          <p>You don't have a bowler account linked to your user profile.</p>
          {currentUser.data.isAdmin && (
            <div className="p-4 border rounded-md bg-amber-50 max-w-md mx-auto">
              <p className="text-amber-800">As an administrator, you can view payment history by selecting a specific bowler.</p>
            </div>
          )}
          <Link href="/" className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-white">
            Return to Dashboard
          </Link>
        </div>
      </BowlerLayout>
    );
  }

  // Show error if bowler is not found
  if (bowlerId && bowlerError) {
    return (
      <BowlerLayout bowlerName="Error" leagueName="Error">
        <div className="text-center text-destructive">
          Failed to load bowler information
        </div>
      </BowlerLayout>
    );
  }

  // Show error if bowler has no associated leagues
  if (!bowlerLeaguesResponse?.data?.length) {
    return (
      <BowlerLayout bowlerName={bowlerName || 'Bowler'} leagueName="No League">
        <div className="text-center space-y-4">
          <p>You are not registered in any leagues</p>
          <Link href="/bowler-dashboard" className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-white">
            Return to Dashboard
          </Link>
        </div>
      </BowlerLayout>
    );
  }

  if (!league) {
    return (
      <BowlerLayout bowlerName={bowlerName} leagueName="League not found">
        <div className="text-center space-y-4">
          <p>League information cannot be loaded for this bowler</p>
          <div className="text-left border p-4 rounded-md bg-muted/30">
            <p className="font-mono text-sm">BowlerId: {bowlerId}</p>
            <p className="font-mono text-sm">LeagueId: {leagueId}</p>
          </div>
          <Link href="/bowler-dashboard" className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-white">
            Return to Dashboard
          </Link>
        </div>
      </BowlerLayout>
    );
  }

  return (
    <BowlerLayout bowlerName={bowlerName} leagueName={league.name}>
      <div className="space-y-6">
        <Link
          href="/bowler-dashboard"
          className="text-muted-foreground hover:text-foreground flex items-center mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Link>

        <div>
          <h1 className="text-2xl font-bold mb-2">Payment History</h1>
          <p className="text-muted-foreground mb-6">
            Track your payments and balance for {league.name}
          </p>
        </div>

        {/* Six detailed payment cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Weekly Fee</CardTitle>
              <CardDescription>Regular payment amount</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">${((league?.weeklyFee || 0) / 100).toFixed(2)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Amount Due to Date</CardTitle>
              <CardDescription>
                {weeksDue} week{weeksDue === 1 ? "" : "s"} at ${(
                  (league?.weeklyFee || 0) / 100
                ).toFixed(2)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">${(totalSeasonDues / 100).toFixed(2)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Amount Paid to Date</CardTitle>
              <CardDescription>All payments received</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">${(totalPaidAmount / 100).toFixed(2)}</p>
            </CardContent>
          </Card>

          <Card
            className={amountPastDue > 0 ? "cursor-pointer transition-colors hover:border-destructive/50 hover:bg-destructive/5" : ""}
            onClick={() => amountPastDue > 0 && setPayDialogType('pastdue')}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Amount Past Due to Date</CardTitle>
              <CardDescription>{amountPastDue > 0 ? "Click to make a payment" : "No amount past due"}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-destructive">${(amountPastDue / 100).toFixed(2)}</p>
            </CardContent>
          </Card>

          {/* Replaced Card Component */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Full Season Lineage Amount Due</CardTitle>
              <CardDescription>
                {totalWeeksInSeason} week{totalWeeksInSeason === 1 ? "" : "s"} at ${(
                  (league?.weeklyFee || 0) / 100
                ).toFixed(2)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">${(fullSeasonAmount / 100).toFixed(2)}</p>
            </CardContent>
          </Card>

          <Card
            className={remainingBalance > 0 ? "cursor-pointer transition-colors hover:border-primary/50 hover:bg-primary/5" : ""}
            onClick={() => remainingBalance > 0 && setPayDialogType('remaining')}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Full Season Remaining Balance</CardTitle>
              <CardDescription>{remainingBalance > 0 ? "Click to pay off balance" : "Fully paid"}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">${(remainingBalance / 100).toFixed(2)}</p>
            </CardContent>
          </Card>

          {finalTwoWeeksAmount > 0 && (
            <Card className={`${
              finalTwoWeeksIsPaid
                ? 'border-green-500/50 bg-green-500/5'
                : finalTwoWeeksIsPastDue
                  ? 'border-destructive/50 bg-destructive/5'
                  : ''
            }`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Final 2 Weeks</CardTitle>
                <CardDescription>
                  Due by Week {finalTwoWeeksDueByWeek}
                  {finalTwoWeeksDueByDate && ` (${format(finalTwoWeeksDueByDate, 'MMM d, yyyy')})`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className={`text-2xl font-bold ${
                  finalTwoWeeksIsPaid
                    ? 'text-green-600'
                    : finalTwoWeeksIsPastDue
                      ? 'text-destructive'
                      : ''
                }`}>
                  ${(finalTwoWeeksAmount / 100).toFixed(2)}
                </p>
                <p className={`text-sm font-medium mt-1 ${
                  finalTwoWeeksIsPaid
                    ? 'text-green-600'
                    : finalTwoWeeksIsPastDue
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                }`}>
                  {finalTwoWeeksIsPaid
                    ? `Paid on Week ${finalTwoWeeksPaidOnWeek ?? '?'}`
                    : finalTwoWeeksIsPastDue ? 'Past Due' : 'Due'}
                </p>
              </CardContent>
            </Card>
          )}

          <Dialog open={!!payDialogType} onOpenChange={(open) => !open && setPayDialogType(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{payDialogType === 'pastdue' ? 'Pay Past Due Amount' : 'Pay Remaining Balance'}</DialogTitle>
                <DialogDescription>
                  {payDialogType === 'pastdue'
                    ? `Pay your outstanding balance of $${(amountPastDue / 100).toFixed(2)}`
                    : `Pay off your remaining season balance of $${(remainingBalance / 100).toFixed(2)}`}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="rounded-md border p-4 bg-muted/50">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Amount</span>
                    <span className="text-lg font-bold">${(dialogAmount / 100).toFixed(2)}</span>
                  </div>
                </div>

                {savedCards.length > 0 && (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={cardMode === 'saved' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setCardMode('saved')}
                      className="flex items-center gap-2"
                    >
                      <Wallet className="h-4 w-4" />
                      Saved Card
                    </Button>
                    <Button
                      type="button"
                      variant={cardMode === 'new' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setCardMode('new')}
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
                  <div className="space-y-3">
                    <label className="text-sm font-medium mb-2 block">Card Details</label>
                    <div
                      ref={(el) => cardCallbackRef.current(el)}
                      className="min-h-[80px] rounded-md border p-3"
                    />
                    <div className="flex items-center space-x-3">
                      <Checkbox
                        id="store-card-history"
                        checked={storeCard}
                        onCheckedChange={(checked) => setStoreCard(checked === true)}
                      />
                      <Label htmlFor="store-card-history" className="text-sm cursor-pointer">
                        Save this card for future payments
                      </Label>
                    </div>
                  </div>
                )}

                <Button
                  onClick={handleDialogPayment}
                  disabled={
                    (cardMode === 'new' && !isInitialized) ||
                    (cardMode === 'saved' && !selectedSavedCardId) ||
                    isSubmitting
                  }
                  className="w-full"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <CreditCard className="mr-2 h-4 w-4" />
                      Pay ${(dialogAmount / 100).toFixed(2)}
                    </>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Payment History Table */}
        <Card>
          <CardHeader>
            <CardTitle>Payment History</CardTitle>
            <CardDescription>Record of all your payments</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Week</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bowlerPayments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-4">
                      No payments recorded
                    </TableCell>
                  </TableRow>
                ) : (
                  bowlerPayments.map((payment) => {
                    const weekNumber = league.seasonStart
                      ? Math.max(1, differenceInWeeks(new Date(payment.weekOf), new Date(league.seasonStart)) + 1)
                      : '-';

                    return (
                      <TableRow key={payment.id}>
                        <TableCell>
                          {format(new Date(payment.weekOf), 'MM/dd/yy')}
                        </TableCell>
                        <TableCell>
                          Week {weekNumber}
                        </TableCell>
                        <TableCell>
                          ${(payment.amount / 100).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {payment.type === 'cash' ? 'Cash' :
                              payment.type === 'check' ? `Check #${payment.checkNumber}` :
                                payment.type === 'credit_card' ? 'Credit Card' :
                                  'Other Payment'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </BowlerLayout>
  );
}