import { useEffect, useRef, useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSquarePayment } from "@/hooks/use-square-payment";
import { useCloverPayment } from "@/hooks/use-clover-payment";
import { usePaymentProvider } from "@/hooks/use-payment-provider";
import { useWalletPayments } from "@/hooks/use-wallet-payments";
import { Form } from "@/components/ui/form";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { insertPaymentSchema, DEFAULT_WEEKLY_FEE_CENTS } from "@shared/schema";
import type { InsertPayment, Bowler, League } from "@shared/schema";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, AlertCircle, AlertTriangle, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CLOVER_FIELD_LABELS } from "@shared/schema";
import { PaymentCreditCardSection } from "@/components/payment-credit-card-section";
import { csrfFetch } from '@/lib/queryClient';
import {
  isProviderNotConfiguredError,
  providerNotConfiguredToast,
  makeApiError,
} from "@/lib/provider-not-configured";
import { useLocation } from "wouter";
import { PaymentFormFields } from "@/components/payment-form-fields";
import { PaymentMethodTabs } from "@/components/payment-method-tabs";
import { usePaymentFormSubmit } from "@/hooks/use-payment-form-submit";

interface SavedCard {
  id: string;
  last4: string;
  brand: string;
  expMonth: number;
  expYear: number;
}

interface PaymentFormProps {
  open: boolean;
  onClose: () => void;
  bowlers: Bowler[];
  leagueId?: number;
}

export function PaymentForm({ open, onClose, bowlers, leagueId }: PaymentFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const cardContainerRef = useRef<HTMLDivElement>(null);
  const [isSquareReady, setIsSquareReady] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [activePaymentMethod, setActivePaymentMethod] = useState<'credit' | 'cash' | 'check'>('credit');
  const [squareLoadFailed, setSquareLoadFailed] = useState(false);
  const [cardMode, setCardMode] = useState<'new' | 'saved'>('new');
  const [selectedSavedCardId, setSelectedSavedCardId] = useState<string>('');
  const [receiptEmail, setReceiptEmail] = useState<string>('');
  const initializationAttempted = useRef(false);

  const { data: leagueData } = useQuery<{ success: boolean; data: League }>({
    queryKey: ['/api/leagues', leagueId],
    enabled: !!leagueId,
  });
  const leagueInfo = leagueData?.data;

  const form = useForm<InsertPayment>({
    resolver: zodResolver(insertPaymentSchema),
    defaultValues: {
      amount: DEFAULT_WEEKLY_FEE_CENTS,
      weekOf: new Date().toISOString(),
      status: "paid",
      type: "cash",
      leagueId: leagueId,
      storeCard: false,
    },
  });

  const {
    config: providerConfig,
    isClover,
    supportsWallets,
    isLoading: providerLoading,
    isProviderConfigured,
    missingFields: providerMissingFields,
  } = usePaymentProvider(leagueInfo?.locationId ?? null);
  // Only Clover currently exposes per-field "missing" data via
  // `/payments-provider/config`. For Square the in-flow toast (driven
  // by PROVIDER_NOT_CONFIGURED on the actual charge) handles the
  // misconfigured case, so we keep this gate Clover-specific to avoid
  // regressing the existing Square behavior. (task #575)
  const cloverNotFullyConfigured =
    isClover && !providerLoading && !isProviderConfigured;

  const {
    card: squareCard,
    isInitialized: squareInitialized,
    error: squareError,
    initializeCard: squareInitializeCard,
    cleanupCard: squareCleanupCard,
  } = useSquarePayment({
    locationId: leagueInfo?.locationId ?? null,
    onError: (error) => {
      form.setValue("type", "cash");
      toast({
        title: "Payment Form Notice",
        description: "Credit card form unavailable. Please try another payment method.",
        variant: "default",
      });
    },
  });

  const {
    card: cvCard,
    isInitialized: cvInitialized,
    error: cvError,
    initializeCard: cvInitializeCard,
    cleanupCard: cvCleanupCard,
  } = useCloverPayment({
    publicTokenizerKey: providerConfig?.publicTokenizerKey,
    merchantId: providerConfig?.merchantId,
    environment: providerConfig?.environment,
    onError: (error) => {
      form.setValue("type", "cash");
      toast({
        title: "Payment Form Notice",
        description: "Credit card form unavailable. Please try another payment method.",
        variant: "default",
      });
    },
  });

  const card = isClover ? cvCard : squareCard;
  const isInitialized = isClover ? cvInitialized : squareInitialized;
  const cardError = isClover ? cvError : squareError;
  const initializeCard = isClover ? cvInitializeCard : squareInitializeCard;
  const cleanupCard = isClover ? cvCleanupCard : squareCleanupCard;

  useEffect(() => {
    if (leagueId) {
      form.setValue('leagueId', leagueId, { shouldDirty: false });
    }
  }, [leagueId]);

  const paymentType = form.watch("type");
  const selectedBowlerId = form.watch("bowlerId");
  const watchedAmount = form.watch("amount");

  const { data: savedCardsResponse } = useQuery<{ success: boolean; data: SavedCard[] }>({
    queryKey: [`/api/payments-provider/cards/${selectedBowlerId}`, leagueId],
    queryFn: async () => {
      const params = leagueId ? `?leagueId=${leagueId}` : '';
      const res = await csrfFetch(`/api/payments-provider/cards/${selectedBowlerId}${params}`);
      if (!res.ok) throw new Error('Failed to fetch saved cards');
      return res.json();
    },
    enabled: !!selectedBowlerId && paymentType === 'credit_card',
    staleTime: 1000 * 60 * 5,
    retry: false,
  });
  const savedCards = savedCardsResponse?.data || [];

  useEffect(() => {
    if (savedCards.length > 0 && paymentType === 'credit_card') {
      setCardMode('saved');
      setSelectedSavedCardId(savedCards[0].id);
    } else {
      setCardMode('new');
      setSelectedSavedCardId('');
    }
  }, [savedCards.length, selectedBowlerId, paymentType]);

  useEffect(() => {
    if (!open || paymentType !== "credit_card") {
      if (isInitialized) {
        cleanupCard();
        setIsSquareReady(false);
        initializationAttempted.current = false;
      }
      return;
    }

    if (providerLoading || !cardContainerRef.current) {
      return;
    }

    // Don't even attempt to spin up the Clover tokenizer when the
    // location's Clover credentials are missing/partial — the SDK
    // load would fail with a generic error and leave the user
    // staring at a broken card form. The friendly notice rendered
    // below tells admins exactly what to fix. (task #575)
    if (cloverNotFullyConfigured) {
      return;
    }
    
    if (isInitialized) {
      setIsSquareReady(true);
      return;
    }
    
    if (initializationAttempted.current && isSquareReady) {
      return;
    }

    initializationAttempted.current = true;
    setPaymentError(null);
    
    const container = cardContainerRef.current;
    
    const initTimeout = setTimeout(() => {
      if (!isSquareReady) {
        setPaymentError('Failed to initialize payment form in a timely manner');
        form.setValue("type", "cash", { shouldDirty: false });
        initializationAttempted.current = false;
        toast({
          title: "Payment Option Changed",
          description: "Credit card processing unavailable at this time. Switched to cash payment.",
          variant: "default",
        });
      }
    }, 5000);
    
    setTimeout(() => {
      initializeCard(container)
        .then(() => {
          setIsSquareReady(true);
          clearTimeout(initTimeout);
        })
        .catch((error) => {
          setIsSquareReady(false);
          setPaymentError(error instanceof Error ? error.message : 'Failed to initialize payment form');
          initializationAttempted.current = false;
          clearTimeout(initTimeout);
          
          form.setValue("type", "cash", { shouldDirty: false });
          toast({
            title: "Payment Form Notice",
            description: "Credit card form unavailable. Please try another payment method.",
            variant: "default",
          });
        });
    }, 300);
    
    return () => {
      clearTimeout(initTimeout);
    };
  }, [open, paymentType, isInitialized, isSquareReady, cleanupCard, initializeCard, toast, form, providerLoading]);

  useEffect(() => {
    if (!open) {
      form.reset();
      setCardMode('new');
      setSelectedSavedCardId('');
      setReceiptEmail('');
    }
  }, [open]);

  // clear inline receipt-email when the operator switches
  // to a different bowler so we never accidentally reuse the prior
  // bowler's typed-in address.
  useEffect(() => {
    setReceiptEmail('');
  }, [selectedBowlerId]);

  const handleWalletPayment = useCallback(async (token: string, walletType: 'apple_pay' | 'google_pay') => {
    const bowlerId = form.getValues('bowlerId');
    const amount = form.getValues('amount');
    const currentLeagueId = form.getValues('leagueId');

    if (!bowlerId || !amount || !currentLeagueId) {
      setPaymentError('Please select a bowler and enter an amount before paying');
      return;
    }

    // thread the inline-captured email through wallet
    // (Apple Pay / Google Pay) charges too, so Square's hosted
    // receipt fires for bowlers with no email on file. Mirrors the
    // server's BUYER_EMAIL_REQUIRED gate to avoid an avoidable 400
    // round-trip mid-wallet-flow.
    const selected = bowlers.find((b) => b.id === bowlerId);
    const trimmedReceiptEmail = receiptEmail.trim();
    // only Square enforces
    // BUYER_EMAIL_REQUIRED server-side; Clover doesn't emit
    // hosted receipts so it must NOT be blocked here.
    if (!isClover && !selected?.email && !trimmedReceiptEmail) {
      setPaymentError(
        'This bowler has no email on file. Enter an email for the receipt before paying with Apple Pay / Google Pay.',
      );
      return;
    }
    const overrideEmail = !selected?.email && trimmedReceiptEmail ? trimmedReceiptEmail : undefined;

    try {
      const response = await csrfFetch('/api/payments-provider/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: token,
          amount,
          bowlerId,
          leagueId: currentLeagueId,
          storeCard: false,
          ...(overrideEmail ? { buyerEmail: overrideEmail } : {}),
        }),
      });

      const responseData = await response.json();
      if (!response.ok) {
        throw makeApiError(responseData, response.status, 'Payment failed');
      }

      const label = walletType === 'apple_pay' ? 'Apple Pay' : 'Google Pay';
      if (responseData.deduplicated) {
        toast({ title: "Already Processed", description: `This ${label} payment was already recorded.` });
      } else {
        toast({ title: "Success", description: `Payment processed via ${label}` });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      onClose();
    } catch (error) {
      if (isProviderNotConfiguredError(error)) {
        const props = providerNotConfiguredToast({
          navigate,
          locationId: leagueInfo?.locationId ?? null,
        });
        setPaymentError(props.title);
        toast(props);
        return;
      }
      const errorMessage = error instanceof Error ? error.message : 'Payment failed';
      setPaymentError(errorMessage);
      toast({ title: "Error", description: errorMessage, variant: "destructive" });
    }
  }, [form, toast, queryClient, onClose, bowlers, receiptEmail, navigate, leagueInfo?.locationId]);

  const {
    applePayAvailable,
    googlePayAvailable,
    applePayRef,
    googlePayRef,
    handleApplePayClick,
    handleGooglePayClick,
    isProcessing: isWalletProcessing,
    cleanup: cleanupWallet,
    applePayTokenizeOnly,
    googlePayTokenizeOnly,
  } = useWalletPayments({
    locationId: leagueInfo?.locationId ?? null,
    amountCents: watchedAmount || 0,
    enabled: open && paymentType === 'credit_card' && supportsWallets,
    onTokenReceived: handleWalletPayment,
    onError: (error) => setPaymentError(error),
  });

  useEffect(() => {
    if (!open) {
      cleanupWallet();
    }
  }, [open, cleanupWallet]);

  // when the selected bowler has no email on file, capture
  // one inline so Square's hosted receipt still fires for this charge.
  const selectedBowler = bowlers.find((b) => b.id === selectedBowlerId);
  const bowlerHasEmail = !!selectedBowler?.email;

  const onSubmit = usePaymentFormSubmit({
    form,
    card,
    cardMode,
    selectedSavedCardId,
    setPaymentError,
    onClose,
    isClover,
    buyerEmail: !bowlerHasEmail ? receiptEmail : undefined,
  });

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
        </DialogHeader>

        {(leagueInfo?.squareLineageItemName || leagueInfo?.squarePrizeFundItemName) && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-1">
                <div>Weekly fee: <span className="font-medium">${(leagueInfo.weeklyFee / 100).toFixed(2)}</span></div>
                {leagueInfo.squareLineageItemName && (
                  <div className="text-xs text-muted-foreground">Lineage: {leagueInfo.squareLineageItemName}</div>
                )}
                {leagueInfo.squarePrizeFundItemName && (
                  <div className="text-xs text-muted-foreground">Prize Fund: {leagueInfo.squarePrizeFundItemName}</div>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {paymentError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{paymentError}</AlertDescription>
              </Alert>
            )}

            <PaymentFormFields form={form} bowlers={bowlers} />

            <PaymentMethodTabs
              form={form}
              paymentType={paymentType}
              squareLoadFailed={squareLoadFailed}
            />

            {paymentType === "check" && (
              <FormField
                control={form.control}
                name="checkNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Check Number</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* only Square enforces
                BUYER_EMAIL_REQUIRED. Don't render the inline gate
                for Clover — it has no hosted-receipt support
                and the server doesn't require buyerEmail. */}
            {paymentType === "credit_card" && selectedBowlerId && !bowlerHasEmail && !isClover && (
              <FormItem>
                <FormLabel>
                  Email for receipt <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    placeholder="bowler@example.com"
                    value={receiptEmail}
                    onChange={(e) => setReceiptEmail(e.target.value)}
                  />
                </FormControl>
                <p className="text-xs text-muted-foreground">
                  This bowler has no email on file. Add one to send a Square receipt.
                </p>
              </FormItem>
            )}

            {paymentType === "credit_card" && cloverNotFullyConfigured && (
              <Alert variant="destructive" data-testid="alert-clover-not-configured">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Clover isn't fully set up for this location</AlertTitle>
                <AlertDescription>
                  <p className="text-sm">
                    Card payments are unavailable until every required Clover
                    credential is filled in.
                  </p>
                  {providerMissingFields.length > 0 && (
                    <p className="text-xs mt-2">
                      Missing:{" "}
                      <span className="font-medium">
                        {providerMissingFields
                          .map((f) => CLOVER_FIELD_LABELS[f])
                          .join(", ")}
                      </span>
                      .
                    </p>
                  )}
                  <p className="text-xs mt-2">
                    Ask your league admin to finish configuring Clover in
                    Settings, then try again. Cash and check payments still
                    work in the meantime.
                  </p>
                </AlertDescription>
              </Alert>
            )}

            {paymentType === "credit_card" && !cloverNotFullyConfigured && (
              <PaymentCreditCardSection
                form={form}
                savedCards={savedCards}
                cardMode={cardMode}
                setCardMode={setCardMode}
                selectedSavedCardId={selectedSavedCardId}
                setSelectedSavedCardId={setSelectedSavedCardId}
                isSquareReady={isSquareReady}
                squareError={cardError}
                squareLoadFailed={squareLoadFailed}
                cardContainerRef={cardContainerRef}
                onCleanupCard={cleanupCard}
                initializationAttempted={initializationAttempted}
                setIsSquareReady={setIsSquareReady}
                applePayAvailable={supportsWallets && applePayAvailable}
                googlePayAvailable={supportsWallets && googlePayAvailable}
                applePayRef={applePayRef}
                googlePayRef={googlePayRef}
                onApplePayClick={handleApplePayClick}
                onGooglePayClick={handleGooglePayClick}
                isWalletProcessing={isWalletProcessing}
                applePayTokenizeOnly={applePayTokenizeOnly}
                googlePayTokenizeOnly={googlePayTokenizeOnly}
              />
            )}

            <div className="flex justify-end space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  form.formState.isSubmitting || 
                  isWalletProcessing ||
                  (paymentType === "credit_card" && cardMode === 'new' && !isSquareReady) ||
                  (paymentType === "credit_card" && cardMode === 'saved' && !selectedSavedCardId) ||
                  // inline email is
                  // required for Square card charges when bowler has
                  // none on file. Server enforces this with
                  // BUYER_EMAIL_REQUIRED; mirrored here so the user
                  // never sees an avoidable round-trip.
                  // Clover doesn't
                  // enforce BUYER_EMAIL_REQUIRED so excluded here.
                  (paymentType === "credit_card" && !!selectedBowlerId && !bowlerHasEmail && !receiptEmail.trim() && !isClover)
                }
              >
                {form.formState.isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  "Submit Payment"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
