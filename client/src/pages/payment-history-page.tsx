import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import type { League, Payment, User, SavedCard, ApiResponse, BowlerDetailsResponse } from "@shared/schema";
import { BowlerLayout } from "@/components/bowler-layout";
import { PageLoadingState, PageErrorState } from "@/components/page-states";
import { Link, useSearch } from "wouter";
import { ChevronDown } from "lucide-react";
import { calculateFinalTwoWeeksPaidOnWeek } from "@/lib/financial-utils";
import { useSquarePayment } from "@/hooks/use-square-payment";
import { useCardPointePayment } from "@/hooks/use-cardpointe-payment";
import { usePaymentProvider } from "@/hooks/use-payment-provider";
import { useWalletPayments } from "@/hooks/use-wallet-payments";
import { createPayment } from "@/lib/square";
import { useToast } from "@/hooks/use-toast";
import { queryClient, csrfFetch } from '@/lib/queryClient';
import { calculateFinancials } from "@/lib/financial-utils";
import { formatCurrency } from "@/lib/utils";
import { PaymentSummaryCards } from "@/components/payment-summary-cards";
import { ErrorBoundary } from "@/components/error-boundary";
import { BowlerPaymentTable } from "@/components/bowler-payment-table";
import { BowlerPaymentDialog } from "@/components/bowler-payment-dialog";
import { LeagueSwitcherSheet } from "@/components/league-switcher-sheet";
import { useSelectedLeague } from "@/hooks/use-selected-league";

export default function PaymentHistoryPage() {
  const { toast } = useToast();
  const search = useSearch();
  const urlLeagueId = new URLSearchParams(search).get('leagueId');
  const [selectedLeagueId, setSelectedLeagueId] = useSelectedLeague(
    urlLeagueId ? Number(urlLeagueId) : undefined
  );
  const [leagueSheetOpen, setLeagueSheetOpen] = useState(false);
  const [payDialogType, setPayDialogType] = useState<'pastdue' | 'remaining' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cardMode, setCardMode] = useState<'new' | 'saved'>('new');
  const [selectedSavedCardId, setSelectedSavedCardId] = useState<string>('');
  const [storeCard, setStoreCard] = useState(false);

  const [isWalletProcessing, setIsWalletProcessing] = useState(false);

  const { data: currentUser, isLoading: loadingUser, error: userError } = useQuery<ApiResponse<User>>({
    queryKey: ["/api/user"],
  });

  const bowlerId = currentUser?.data?.bowlerId;

  const { data: savedCardsResponse } = useQuery<ApiResponse<SavedCard[]>>({
    queryKey: [`/api/payments-provider/cards/${bowlerId}`, selectedLeagueId],
    queryFn: async () => {
      const params = selectedLeagueId ? `?leagueId=${selectedLeagueId}` : '';
      const res = await csrfFetch(`/api/payments-provider/cards/${bowlerId}${params}`);
      if (!res.ok) throw new Error('Failed to fetch saved cards');
      return res.json();
    },
    enabled: !!bowlerId,
    staleTime: 1000 * 60 * 5,
    retry: false,
  });
  const savedCards = savedCardsResponse?.data || [];

  useEffect(() => {
    if (savedCards.length > 0) {
      setCardMode('saved');
      setSelectedSavedCardId(savedCards[0].id);
    } else {
      setCardMode('new');
      setSelectedSavedCardId('');
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

  const { config: providerConfig, isCardPointe, supportsWallets, isLoading: providerLoading } = usePaymentProvider(league?.locationId ?? null);

  const { card: sqCard, isInitialized: sqInit, initializeCard: sqInitCard, cleanupCard: sqCleanup } = useSquarePayment({
    onError: (error) => {
      console.error('[Square Payment Error]:', error);
      toast({ title: "Payment Setup Error", description: error, variant: "destructive" });
    }
  });

  const { card: cpCard, isInitialized: cpInit, initializeCard: cpInitCard, cleanupCard: cpCleanup } = useCardPointePayment({
    tokenizerUrl: providerConfig?.tokenizerUrl,
    onError: (error) => {
      console.error('[CardPointe Payment Error]:', error);
      toast({ title: "Payment Setup Error", description: error, variant: "destructive" });
    }
  });

  const card = isCardPointe ? cpCard : sqCard;
  const isInitialized = isCardPointe ? cpInit : sqInit;
  const initializeCard = isCardPointe ? cpInitCard : sqInitCard;
  const cleanupCard = isCardPointe ? cpCleanup : sqCleanup;

  useEffect(() => {
    if (!payDialogType) {
      cleanupCard();
    }
  }, [payDialogType]);

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

  const dialogAmountCents = payDialogType === 'pastdue' ? amountPastDue : remainingBalance;

  const handleWalletPayment = useCallback(async (token: string, walletType: 'apple_pay' | 'google_pay') => {
    if (!bowlerId || !leagueId || !dialogAmountCents) return;
    try {
      setIsWalletProcessing(true);
      const response = await csrfFetch('/api/payments-provider/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: token,
          amount: dialogAmountCents,
          bowlerId,
          leagueId,
          storeCard: true,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || data.message || `Payment failed (HTTP ${response.status})`);
      }
      const walletLabel = walletType === 'apple_pay' ? 'Apple Pay' : 'Google Pay';
      const dialogLabel = payDialogType === 'pastdue' ? 'past due amount' : 'remaining balance';
      if (data.deduplicated) {
        toast({ title: "Already Processed", description: `This ${walletLabel} payment was already recorded.` });
      } else {
        toast({ title: "Payment Successful", description: `${walletLabel} payment of ${formatCurrency(dialogAmountCents)} ${dialogLabel} completed.` });
      }
      setPayDialogType(null);
      queryClient.invalidateQueries({ queryKey: ["/api/payments", { bowlerId, leagueId }] });
      queryClient.invalidateQueries({ queryKey: [`/api/bowlers/${bowlerId}/details`] });
      queryClient.invalidateQueries({ queryKey: [`/api/payments-provider/cards/${bowlerId}`] });
    } catch (error) {
      console.error('[Wallet Payment Error]:', error);
      toast({ title: "Payment Failed", description: error instanceof Error ? error.message : "Unable to process payment.", variant: "destructive" });
    } finally {
      setIsWalletProcessing(false);
    }
  }, [bowlerId, leagueId, dialogAmountCents, payDialogType, toast]);

  const {
    applePayAvailable,
    googlePayAvailable,
    applePayTokenizeOnly,
    googlePayTokenizeOnly,
    applePayRef,
    googlePayRef,
    handleApplePayClick,
    handleGooglePayClick,
    isProcessing: isWalletBusy,
    cleanup: cleanupWallet,
  } = useWalletPayments({
    locationId: league?.locationId,
    amountCents: dialogAmountCents,
    enabled: !!payDialogType && !!league?.locationId && supportsWallets,
    onTokenReceived: handleWalletPayment,
    onError: (error) => toast({ title: "Wallet Payment Error", description: error, variant: "destructive" }),
  });

  useEffect(() => {
    if (!payDialogType) {
      cleanupWallet();
    }
  }, [payDialogType, cleanupWallet]);

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
        const response = await csrfFetch('/api/payments-provider/payments', {
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
        await createPayment(dialogAmount, card!, bowlerId, leagueId, storeCard);
        if (storeCard) {
          queryClient.invalidateQueries({ queryKey: [`/api/payments-provider/cards/${bowlerId}`] });
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
        <div>
          <h1 className="text-2xl font-bold mb-1">Payment History</h1>
          {hasMultipleLeagues ? (
            <button
              onClick={() => setLeagueSheetOpen(true)}
              className="flex items-center gap-1 text-slate-500 hover:text-slate-700 transition-colors mb-4"
            >
              <span>{league.name}</span>
              <ChevronDown className="w-4 h-4" />
            </button>
          ) : (
            <p className="text-muted-foreground mb-4">
              {league.name}
            </p>
          )}
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
            applePayAvailable={applePayAvailable}
            googlePayAvailable={googlePayAvailable}
            applePayTokenizeOnly={applePayTokenizeOnly}
            googlePayTokenizeOnly={googlePayTokenizeOnly}
            applePayRef={applePayRef}
            googlePayRef={googlePayRef}
            onApplePayClick={handleApplePayClick}
            onGooglePayClick={handleGooglePayClick}
            isWalletProcessing={isWalletBusy || isWalletProcessing}
          />
        </ErrorBoundary>

        <ErrorBoundary level="section">
          <BowlerPaymentTable payments={bowlerPayments} league={league} />
        </ErrorBoundary>
      </div>

      <LeagueSwitcherSheet
        open={leagueSheetOpen}
        onClose={() => setLeagueSheetOpen(false)}
        bowlerLeagues={bowlerLeagues}
        leagueMap={leagueMap}
        selectedLeagueId={leagueId}
        onSelect={setSelectedLeagueId}
      />
    </BowlerLayout>
  );
}
