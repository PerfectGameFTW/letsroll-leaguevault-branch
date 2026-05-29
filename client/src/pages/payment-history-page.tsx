import { useState, useEffect, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import type { League, Payment, User, SavedCard, ApiResponse, BowlerDetailsResponse } from "@shared/schema";
import { BowlerLayout } from "@/components/bowler-layout";
import { PageLoadingState, PageErrorState } from "@/components/page-states";
import { Link, useSearch, useLocation as useWouterLocation } from "wouter";
import { ChevronDown } from "lucide-react";
import { useSquarePayment } from "@/hooks/use-square-payment";
import { useCloverPayment } from "@/hooks/use-clover-payment";
import { usePaymentProvider } from "@/hooks/use-payment-provider";
import { useWalletPayments } from "@/hooks/use-wallet-payments";
import { createPayment } from "@/lib/square";
import { useToast } from "@/hooks/use-toast";
import { queryClient, csrfFetch } from '@/lib/queryClient';
import {
  isProviderNotConfiguredError,
  providerNotConfiguredToast,
  makeApiError,
} from "@/lib/provider-not-configured";
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
  const [, navigate] = useWouterLocation();
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
  const [receiptEmail, setReceiptEmail] = useState('');

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
  const firstSavedCardId = savedCards.length > 0 ? savedCards[0].id : null;

  useEffect(() => {
    if (firstSavedCardId !== null) {
      setCardMode('saved');
      setSelectedSavedCardId(firstSavedCardId);
    } else {
      setCardMode('new');
      setSelectedSavedCardId('');
    }
  }, [firstSavedCardId]);

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

  const bowlerLeagues = useMemo(() => bowlerDetailsResponse?.data?.bowlerLeagues ?? [], [bowlerDetailsResponse?.data?.bowlerLeagues]);
  const hasMultipleLeagues = bowlerLeagues.length > 1;

  useEffect(() => {
    if (!bowlerLeagues.length) return;
    const validIds = bowlerLeagues.map(bl => bl.leagueId);
    if (selectedLeagueId !== null && !validIds.includes(selectedLeagueId)) {
      setSelectedLeagueId(validIds[0]);
    }
  }, [bowlerLeagues, selectedLeagueId, setSelectedLeagueId]);

  const leagueId = selectedLeagueId ?? bowlerLeagues[0]?.leagueId;

  const detailsLeagues = useMemo(() => bowlerDetailsResponse?.data?.leagues || [], [bowlerDetailsResponse?.data?.leagues]);

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

  const { config: providerConfig, isClover, supportsWallets, isLoading: providerLoading } = usePaymentProvider(league?.locationId ?? null);

  const { card: sqCard, isInitialized: sqInit, initializeCard: sqInitCard, cleanupCard: sqCleanup } = useSquarePayment({
    onError: (error) => {
      console.error('[Square Payment Error]:', error);
      toast({ title: "Payment Setup Error", description: error, variant: "destructive" });
    }
  });

  const { card: cvCard, isInitialized: cvInit, initializeCard: cvInitCard, cleanupCard: cvCleanup } = useCloverPayment({
    publicTokenizerKey: providerConfig?.publicTokenizerKey,
    merchantId: providerConfig?.merchantId,
    environment: providerConfig?.environment,
    onError: (error) => {
      console.error('[Clover Payment Error]:', error);
      toast({ title: "Payment Setup Error", description: error, variant: "destructive" });
    }
  });

  const card = isClover ? cvCard : sqCard;
  const isInitialized = isClover ? cvInit : sqInit;
  const initializeCard = isClover ? cvInitCard : sqInitCard;
  const cleanupCard = isClover ? cvCleanup : sqCleanup;

  useEffect(() => {
    if (!payDialogType) {
      cleanupCard();
      // clear inline receipt-email on dialog close so a
      // stale typed-in address never silently rides on the next
      // checkout attempt.
      setReceiptEmail('');
    }
  }, [payDialogType, cleanupCard]);

  const payments = hasPaymentsFromDetails ? allPaymentsFromDetails : (paymentsResponse?.data || []);
  const bowlerName = bowlerDetailsResponse?.data?.bowler?.name || '';
  const bowlerEmail = bowlerDetailsResponse?.data?.bowler?.email || '';

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
    doublePay,
  } = financials;
  const weeksDueCount = league?.weeklyFee ? Math.round(totalSeasonDues / league.weeklyFee) : 0;
  const weeksPaid = league?.weeklyFee ? Math.round(totalPaidAmount / league.weeklyFee) : 0;

  const dialogAmountCents = payDialogType === 'pastdue' ? amountPastDue : remainingBalance;

  const handleWalletPayment = useCallback(async (token: string, walletType: 'apple_pay' | 'google_pay') => {
    if (!bowlerId || !leagueId || !dialogAmountCents) return;
    // same inline email override as the card-form path so
    // Apple Pay / Google Pay charges also trigger Square's hosted
    // receipt when no email is on file for the bowler. Mirrors the
    // server's BUYER_EMAIL_REQUIRED so the wallet sheet doesn't
    // launch into an avoidable 400.
    const trimmedReceiptEmail = receiptEmail.trim();
    // only Square enforces
    // BUYER_EMAIL_REQUIRED server-side; Clover doesn't emit
    // hosted receipts so don't block its wallet flow either.
    if (!isClover && !bowlerEmail && !trimmedReceiptEmail) {
      toast({
        title: 'Email required',
        description: 'Enter an email for the receipt before paying with Apple Pay / Google Pay.',
        variant: 'destructive',
      });
      return;
    }
    const overrideEmail = !bowlerEmail && trimmedReceiptEmail ? trimmedReceiptEmail : undefined;
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
          ...(overrideEmail ? { buyerEmail: overrideEmail } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw makeApiError(data, response.status, `Payment failed (HTTP ${response.status})`);
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
      if (isProviderNotConfiguredError(error)) {
        toast(providerNotConfiguredToast({
          navigate,
          locationId: league?.locationId ?? null,
          provider: isClover ? 'clover' : 'square',
        }));
      } else {
        toast({ title: "Payment Failed", description: error instanceof Error ? error.message : "Unable to process payment.", variant: "destructive" });
      }
    } finally {
      setIsWalletProcessing(false);
    }
  }, [bowlerId, leagueId, dialogAmountCents, payDialogType, toast, bowlerEmail, receiptEmail, navigate, league?.locationId, isClover]);

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

      // when no email is on file, the bowler can supply
      // one inline so Square's hosted receipt fires for this charge.
      const trimmedReceiptEmail = receiptEmail.trim();
      const overrideEmail = !bowlerEmail && trimmedReceiptEmail ? trimmedReceiptEmail : undefined;

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
            ...(overrideEmail ? { buyerEmail: overrideEmail } : {}),
          }),
        });
        const responseData = await response.json();
        if (!response.ok) {
          throw makeApiError(responseData, response.status, 'Payment failed');
        }
      } else {
        await createPayment(dialogAmount, card!, bowlerId, leagueId, storeCard, overrideEmail);
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
      if (isProviderNotConfiguredError(error)) {
        toast(providerNotConfiguredToast({
          navigate,
          locationId: league?.locationId ?? null,
          provider: isClover ? 'clover' : 'square',
        }));
      } else {
        toast({ title: "Payment Failed", description: error instanceof Error ? error.message : "Unable to process payment. Please try again.", variant: "destructive" });
      }
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
            <button type="button"
              onClick={() => setLeagueSheetOpen(true)}
              className="flex items-center gap-1 text-slate-500 hover:text-slate-700 transition-colors mb-4"
            >
              <span>{league.name}</span>
              <ChevronDown className="size-4" />
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
            doublePay={doublePay}
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
            bowlerHasEmail={!!bowlerEmail || isClover}
            receiptEmail={receiptEmail}
            onReceiptEmailChange={setReceiptEmail}
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
