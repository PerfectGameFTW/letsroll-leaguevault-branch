import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import type { League, Payment, User, SavedCard, ApiResponse, BowlerDetailsResponse } from "@shared/schema";
import { BowlerLayout } from "@/components/bowler-layout";
import { ArrowLeft } from "lucide-react";
import { PageLoadingState, PageErrorState } from "@/components/page-states";
import { Link, useSearch } from "wouter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { differenceInWeeks } from "date-fns";
import { calculateFinalTwoWeeksPaidOnWeek } from "@/lib/financial-utils";
import { useSquarePayment } from "@/hooks/use-square-payment";
import { createPayment } from "@/lib/square";
import { useToast } from "@/hooks/use-toast";
import { queryClient, csrfFetch } from '@/lib/queryClient';
import { calculateFinancials } from "@/lib/financial-utils";
import { formatCurrency } from "@/lib/utils";
import { PaymentSummaryCards } from "@/components/payment-summary-cards";
import { ErrorBoundary } from "@/components/error-boundary";
import { BowlerPaymentTable } from "@/components/bowler-payment-table";
import { BowlerPaymentDialog } from "@/components/bowler-payment-dialog";

export default function PaymentHistoryPage() {
  const { toast } = useToast();
  const search = useSearch();
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

  useEffect(() => {
    if (!payDialogType) {
      cleanupCard();
    }
  }, [payDialogType]);

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

  const { data: bowlerDetailsResponse, isLoading: loadingBowlerDetails, error: bowlerError } = useQuery<ApiResponse<BowlerDetailsResponse>>({
    queryKey: [`/api/bowlers/${bowlerId}/details`, { includePayments: true }],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/bowlers/${bowlerId}/details?includePayments=true`, {
        credentials: "include",
        headers: { "Accept": "application/json" },
        signal,
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error?.message || "Failed to fetch bowler details");
      }
      return response.json();
    },
    enabled: !!bowlerId,
  });

  const bowlerLeagues = bowlerDetailsResponse?.data?.bowlerLeagues ?? [];
  const hasMultipleLeagues = bowlerLeagues.length > 1;

  useEffect(() => {
    if (!bowlerLeagues.length) return;
    const validIds = bowlerLeagues.map(bl => bl.leagueId);
    if (selectedLeagueId !== null && !validIds.includes(selectedLeagueId)) {
      setSelectedLeagueId(validIds[0]);
    }
  }, [bowlerLeagues.map(bl => bl.leagueId).join(',')]);

  const leagueId = selectedLeagueId ?? bowlerLeagues[0]?.leagueId;

  const detailsLeagues = bowlerDetailsResponse?.data?.leagues || [];

  const leagueMap = useMemo(() => {
    const map = new Map<number, League>();
    for (const l of detailsLeagues) map.set(l.id, l);
    return map;
  }, [detailsLeagues]);

  const detailsLoaded = !!bowlerDetailsResponse?.data;
  const allPaymentsFromDetails = bowlerDetailsResponse?.data?.payments;
  const hasPaymentsFromDetails = Array.isArray(allPaymentsFromDetails);

  const { data: paymentsResponse, isLoading: loadingPayments } = useQuery<ApiResponse<Payment[]>>({
    queryKey: ["/api/payments", { bowlerId, leagueId }],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      params.set("bowlerId", String(bowlerId));
      params.set("leagueId", String(leagueId));
      const response = await fetch(`/api/payments?${params.toString()}`, {
        credentials: "include",
        headers: { "Accept": "application/json" },
        signal,
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error?.message || "Failed to fetch payments");
      }
      return response.json();
    },
    enabled: !!bowlerId && !!leagueId && detailsLoaded && !hasPaymentsFromDetails,
  });

  const league = leagueMap.get(leagueId!);
  const payments = hasPaymentsFromDetails ? allPaymentsFromDetails : (paymentsResponse?.data || []);
  const bowlerName = bowlerDetailsResponse?.data?.bowler?.name || '';

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

  const finalTwoWeeksPaidOnWeek =
    finalTwoWeeks.isPaid && finalTwoWeeks.amount > 0 && league?.seasonStart
      ? calculateFinalTwoWeeksPaidOnWeek(bowlerPayments, finalTwoWeeks.amount, league.seasonStart)
      : null;

  const handleDialogPayment = async () => {
    const dialogAmount = payDialogType === 'pastdue' ? amountPastDue : remainingBalance;
    const dialogLabel = payDialogType === 'pastdue' ? 'past due amount' : 'remaining balance';

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
        const response = await csrfFetch('/api/square/payments', {
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
      queryClient.invalidateQueries({ queryKey: ["/api/payments", { bowlerId, leagueId }] });
      queryClient.invalidateQueries({ queryKey: [`/api/bowlers/${bowlerId}/details`] });
    } catch (error) {
      console.error('[Payment Error]:', error);
      toast({ title: "Payment Failed", description: error instanceof Error ? error.message : "Unable to process payment. Please try again.", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loadingUser || loadingBowlerDetails || (!hasPaymentsFromDetails && loadingPayments)) {
    return (
      <BowlerLayout bowlerName={bowlerName || 'Loading...'} leagueName={league?.name || 'Loading...'}>
        <PageLoadingState />
      </BowlerLayout>
    );
  }

  if (userError) {
    return (
      <BowlerLayout bowlerName="Authentication Error" leagueName="Error">
        <PageErrorState message="Please log in to view payment history" />
        <div className="text-center mt-4">
          <Link href="/login" className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-white">
            Log In
          </Link>
        </div>
      </BowlerLayout>
    );
  }
  
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

  if (bowlerId && bowlerError) {
    return (
      <BowlerLayout bowlerName="Error" leagueName="Error">
        <div className="text-center text-destructive">
          Failed to load bowler information
        </div>
      </BowlerLayout>
    );
  }

  if (!bowlerDetailsResponse?.data?.bowlerLeagues?.length) {
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
          <BowlerPaymentDialog
            payDialogType={payDialogType}
            onClose={() => setPayDialogType(null)}
            amountPastDue={amountPastDue}
            remainingBalance={remainingBalance}
            savedCards={savedCards}
            cardMode={cardMode}
            setCardMode={setCardMode}
            selectedSavedCardId={selectedSavedCardId}
            setSelectedSavedCardId={setSelectedSavedCardId}
            storeCard={storeCard}
            setStoreCard={setStoreCard}
            isInitialized={isInitialized}
            isSubmitting={isSubmitting}
            onSubmit={handleDialogPayment}
            initializeCard={initializeCard}
            cleanupCard={cleanupCard}
          />
        </ErrorBoundary>

        <ErrorBoundary level="section">
          <BowlerPaymentTable payments={bowlerPayments} league={league} />
        </ErrorBoundary>
      </div>
    </BowlerLayout>
  );
}
