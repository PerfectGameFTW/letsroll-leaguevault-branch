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
import { useCardPointePayment } from "@/hooks/use-cardpointe-payment";
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
import { Loader2, AlertCircle, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PaymentCreditCardSection } from "@/components/payment-credit-card-section";
import { csrfFetch } from '@/lib/queryClient';
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

  const { config: providerConfig, isCardPointe, supportsWallets, isLoading: providerLoading } = usePaymentProvider(leagueInfo?.locationId ?? null);

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
    card: cpCard,
    isInitialized: cpInitialized,
    error: cpError,
    initializeCard: cpInitializeCard,
    cleanupCard: cpCleanupCard,
  } = useCardPointePayment({
    tokenizerUrl: providerConfig?.tokenizerUrl,
    onError: (error) => {
      form.setValue("type", "cash");
      toast({
        title: "Payment Form Notice",
        description: "Credit card form unavailable. Please try another payment method.",
        variant: "default",
      });
    },
  });

  const card = isCardPointe ? cpCard : squareCard;
  const isInitialized = isCardPointe ? cpInitialized : squareInitialized;
  const cardError = isCardPointe ? cpError : squareError;
  const initializeCard = isCardPointe ? cpInitializeCard : squareInitializeCard;
  const cleanupCard = isCardPointe ? cpCleanupCard : squareCleanupCard;

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

  // Task #503: clear inline receipt-email when the operator switches
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

    // Task #503: thread the inline-captured email through wallet
    // (Apple Pay / Google Pay) charges too, so Square's hosted
    // receipt fires for bowlers with no email on file. Mirrors the
    // server's BUYER_EMAIL_REQUIRED gate to avoid an avoidable 400
    // round-trip mid-wallet-flow.
    const selected = bowlers.find((b) => b.id === bowlerId);
    const trimmedReceiptEmail = receiptEmail.trim();
    // Task #503 (8th-pass review): only Square enforces
    // BUYER_EMAIL_REQUIRED server-side; CardPointe doesn't emit
    // hosted receipts so it must NOT be blocked here.
    if (!isCardPointe && !selected?.email && !trimmedReceiptEmail) {
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
        throw new Error(responseData.error?.message || 'Payment failed');
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
      const errorMessage = error instanceof Error ? error.message : 'Payment failed';
      setPaymentError(errorMessage);
      toast({ title: "Error", description: errorMessage, variant: "destructive" });
    }
  }, [form, toast, queryClient, onClose, bowlers, receiptEmail]);

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

  // Task #503: when the selected bowler has no email on file, capture
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
    isCardPointe,
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

            {/* Task #503 (8th-pass review): only Square enforces
                BUYER_EMAIL_REQUIRED. Don't render the inline gate
                for CardPointe — it has no hosted-receipt support
                and the server doesn't require buyerEmail. */}
            {paymentType === "credit_card" && selectedBowlerId && !bowlerHasEmail && !isCardPointe && (
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

            {paymentType === "credit_card" && (
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
                  // Task #503 (3rd-pass review): inline email is
                  // required for Square card charges when bowler has
                  // none on file. Server enforces this with
                  // BUYER_EMAIL_REQUIRED; mirrored here so the user
                  // never sees an avoidable round-trip.
                  // Task #503 (8th-pass review): CardPointe doesn't
                  // enforce BUYER_EMAIL_REQUIRED so excluded here.
                  (paymentType === "credit_card" && !!selectedBowlerId && !bowlerHasEmail && !receiptEmail.trim() && !isCardPointe)
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
