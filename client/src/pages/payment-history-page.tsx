import { useState, useRef, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import type { League, Payment, User, SavedCard, ApiResponse } from "@shared/schema";
import { BowlerLayout } from "@/components/bowler-layout";
import { Loader2, ArrowLeft, CreditCard, Wallet } from "lucide-react";
import { Link, useSearch } from "wouter";
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
import { differenceInWeeks, format } from "date-fns";
import { useSquarePayment } from "@/hooks/use-square-payment";
import { createPayment } from "@/lib/square";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { calculateFinancials } from "@/lib/financial-utils";
import { formatCurrency } from "@/lib/utils";
import { PaymentSummaryCards } from "@/components/payment-summary-cards";
import { ErrorBoundary } from "@/components/error-boundary";

export default function PaymentHistoryPage() {
  const { toast } = useToast();
  const search = useSearch();
  // Seed from URL param once on mount; league validity is checked after data loads
  const [selectedLeagueId, setSelectedLeagueId] = useState<number | null>(() => {
    const id = new URLSearchParams(search).get('leagueId');
    return id ? Number(id) : null;
  });
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
  const { data: bowlerLeaguesResponse, isLoading: loadingBowlerLeagues } = useQuery<ApiResponse<{ leagueId: number }[]>>({
    queryKey: ["/api/bowler-leagues", bowlerId],
    enabled: !!bowlerId,
  });

  const bowlerLeagues = bowlerLeaguesResponse?.data ?? [];
  const hasMultipleLeagues = bowlerLeagues.length > 1;

  // Once league data loads, validate selectedLeagueId belongs to this bowler.
  // If invalid (e.g., stale URL param), fall back to the first available league.
  useEffect(() => {
    if (!bowlerLeagues.length) return;
    const validIds = bowlerLeagues.map(bl => bl.leagueId);
    if (selectedLeagueId !== null && !validIds.includes(selectedLeagueId)) {
      setSelectedLeagueId(validIds[0]);
    }
  }, [bowlerLeagues.map(bl => bl.leagueId).join(',')]);

  // Derive the active leagueId: prefer user-selected, fall back to first in list
  const leagueId = selectedLeagueId ?? bowlerLeagues[0]?.leagueId;

  // Fetch all leagues (for dropdown names) when bowler belongs to multiple leagues
  const { data: allLeaguesResponse } = useQuery<ApiResponse<League[]>>({
    queryKey: ['/api/leagues'],
    enabled: !!bowlerId && hasMultipleLeagues,
    staleTime: 1000 * 60 * 5,
  });

  const leagueMap = useMemo(() => {
    const map = new Map<number, League>();
    if (allLeaguesResponse?.data) {
      for (const l of allLeaguesResponse.data) map.set(l.id, l);
    }
    return map;
  }, [allLeaguesResponse?.data]);

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

  const bowlerPayments = payments.filter(p => p.bowlerId === bowlerId && p.leagueId === leagueId);

  const financials = calculateFinancials(league, bowlerPayments);
  const {
    weeksPassed: weeksDue,
    totalWeeksInSeason,
    totalDueToDate: totalSeasonDues,
    totalPaid: totalPaidAmount,
    amountPastDue,
    fullSeasonAmount,
    remainingBalance,
    finalTwoWeeks,
  } = financials;
  const weeksDueCount = league?.weeklyFee ? Math.round(totalSeasonDues / league.weeklyFee) : 0;
  const weeksPaid = league?.weeklyFee ? Math.round(totalPaidAmount / league.weeklyFee) : 0;

  let finalTwoWeeksPaidOnWeek: number | null = null;
  if (finalTwoWeeks.isPaid && finalTwoWeeks.amount > 0 && league?.seasonStart) {
    const seasonStart = new Date(league.seasonStart);
    const totalPaidPayments = bowlerPayments.filter(p => p.status === 'paid');
    const sortedPayments = [...totalPaidPayments].sort(
      (a, b) => new Date(a.weekOf).getTime() - new Date(b.weekOf).getTime()
    );
    let runningTotal = 0;
    for (const p of sortedPayments) {
      runningTotal += p.amount;
      if (runningTotal >= finalTwoWeeks.amount) {
        finalTwoWeeksPaidOnWeek = Math.max(1, differenceInWeeks(new Date(p.weekOf), seasonStart) + 1);
        break;
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

      toast({ title: "Payment Successful", description: `${formatCurrency(dialogAmount)} ${dialogLabel} has been paid.` });
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
          {currentUser.data.role === 'system_admin' && (
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
    <BowlerLayout bowlerName={bowlerName} leagueName={league.name} currentLeagueId={leagueId}>
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
          {hasMultipleLeagues && (
            <div className="mb-4">
              <label className="text-sm font-medium text-muted-foreground">League</label>
              <Select
                value={String(selectedLeagueId ?? leagueId ?? '')}
                onValueChange={(val) => setSelectedLeagueId(Number(val))}
              >
                <SelectTrigger className="w-full md:w-72 mt-1">
                  <SelectValue placeholder="Select a league" />
                </SelectTrigger>
                <SelectContent>
                  {bowlerLeagues.map(bl => {
                    const l = leagueMap.get(bl.leagueId);
                    return (
                      <SelectItem key={bl.leagueId} value={String(bl.leagueId)}>
                        {l?.name ?? `League #${bl.leagueId}`}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}
          <p className="text-muted-foreground mb-6">
            Track your payments and balance for {league.name}
          </p>
        </div>

        <ErrorBoundary level="section">
        <PaymentSummaryCards
          totalWeeksInSeason={totalWeeksInSeason}
          fullSeasonAmount={fullSeasonAmount}
          weeklyFee={league?.weeklyFee || 0}
          weeksDueCount={weeksDueCount}
          totalSeasonDues={totalSeasonDues}
          weeksPaid={weeksPaid}
          totalPaidAmount={totalPaidAmount}
          amountPastDue={amountPastDue}
          remainingBalance={remainingBalance}
          finalTwoWeeks={finalTwoWeeks}
          finalTwoWeeksPaidOnWeek={finalTwoWeeksPaidOnWeek}
          onPayPastDue={() => setPayDialogType('pastdue')}
          onPayRemaining={() => setPayDialogType('remaining')}
        />
        </ErrorBoundary>

        <ErrorBoundary level="section">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Dialog open={!!payDialogType} onOpenChange={(open) => !open && setPayDialogType(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{payDialogType === 'pastdue' ? 'Pay Past Due Amount' : 'Pay Remaining Balance'}</DialogTitle>
                <DialogDescription>
                  {payDialogType === 'pastdue'
                    ? `Pay your outstanding balance of ${formatCurrency(amountPastDue)}`
                    : `Pay off your remaining season balance of ${formatCurrency(remainingBalance)}`}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="rounded-md border p-4 bg-muted/50">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Amount</span>
                    <span className="text-lg font-bold">{formatCurrency(dialogAmount)}</span>
                  </div>
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
                      Pay {formatCurrency(dialogAmount)}
                    </>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        </ErrorBoundary>

        <ErrorBoundary level="section">
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
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bowlerPayments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-4">
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
                          {formatCurrency(payment.amount)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {payment.type === 'cash' ? 'Cash' :
                              payment.type === 'check' ? `Check #${payment.checkNumber}` :
                                payment.type === 'credit_card' ? 'Credit Card' :
                                  'Other Payment'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={payment.status === 'refunded' ? 'destructive' : 'outline'}
                            className={
                              payment.status === 'paid' ? 'border-green-500 text-green-700 bg-green-50' :
                              payment.status === 'failed' ? 'border-yellow-500 text-yellow-700 bg-yellow-50' :
                              payment.status === 'pending' ? 'border-blue-500 text-blue-700 bg-blue-50' :
                              ''
                            }
                          >
                            {payment.status === 'paid' ? 'Paid' :
                              payment.status === 'refunded' ? 'Refunded' :
                              payment.status === 'failed' ? 'Failed' :
                              payment.status === 'pending' ? 'Pending' :
                              payment.status}
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
        </ErrorBoundary>
      </div>
    </BowlerLayout>
  );
}