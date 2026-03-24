import { type MutableRefObject, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FormControl,
  FormField,
  FormItem,
} from "@/components/ui/form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, CreditCard, AlertTriangle, Wallet } from "lucide-react";
import type { UseFormReturn } from "react-hook-form";
import type { InsertPayment } from "@shared/schema";

interface SavedCard {
  id: string;
  last4: string;
  brand: string;
  expMonth: number;
  expYear: number;
}

interface PaymentCreditCardSectionProps {
  form: UseFormReturn<InsertPayment>;
  savedCards: SavedCard[];
  cardMode: 'new' | 'saved';
  setCardMode: (mode: 'new' | 'saved') => void;
  selectedSavedCardId: string;
  setSelectedSavedCardId: (id: string) => void;
  isSquareReady: boolean;
  squareError: string | null;
  squareLoadFailed: boolean;
  cardContainerRef: React.RefObject<HTMLDivElement>;
  onCleanupCard: () => void;
  initializationAttempted: MutableRefObject<boolean>;
  setIsSquareReady: (ready: boolean) => void;
  applePayAvailable: boolean;
  googlePayAvailable: boolean;
  applePayRef: React.RefObject<HTMLDivElement>;
  googlePayRef: React.RefObject<HTMLDivElement>;
  onApplePayClick: () => Promise<void>;
  onGooglePayClick: () => Promise<void>;
  isWalletProcessing: boolean;
  applePayTokenizeOnly?: boolean;
  googlePayTokenizeOnly?: boolean;
}

export function PaymentCreditCardSection({
  form,
  savedCards,
  cardMode,
  setCardMode,
  selectedSavedCardId,
  setSelectedSavedCardId,
  isSquareReady,
  squareError,
  squareLoadFailed,
  cardContainerRef,
  onCleanupCard,
  initializationAttempted,
  setIsSquareReady,
  applePayAvailable,
  googlePayAvailable,
  applePayRef,
  googlePayRef,
  onApplePayClick,
  onGooglePayClick,
  isWalletProcessing,
  applePayTokenizeOnly,
  googlePayTokenizeOnly,
}: PaymentCreditCardSectionProps) {
  const hasWalletOptions = applePayAvailable || googlePayAvailable;

  if (squareLoadFailed) {
    return (
      <Alert variant="destructive" className="mb-4">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Credit Card Processing Unavailable</AlertTitle>
        <AlertDescription>
          Credit card processing is temporarily unavailable. Please use cash or check payment methods instead.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {applePayAvailable && !applePayTokenizeOnly && (
          <div
            ref={applePayRef}
            className="min-h-[40px]"
            onClick={onApplePayClick}
          />
        )}
        {applePayAvailable && applePayTokenizeOnly && (
          <button
            type="button"
            onClick={onApplePayClick}
            disabled={isWalletProcessing}
            style={{
              WebkitAppearance: 'none',
              appearance: 'none',
              backgroundColor: '#000',
              border: 'none',
              borderRadius: '5px',
              width: '100%',
              height: '44px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '2px',
              padding: 0,
              opacity: isWalletProcessing ? 0.5 : 1,
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="21" viewBox="0 0 17 20" fill="white" style={{ position: 'relative', top: '-1px' }}>
              <path d="M13.55 10.63a4.27 4.27 0 0 1 2.04-3.59 4.4 4.4 0 0 0-3.46-1.87c-1.46-.15-2.88.87-3.63.87s-1.91-.85-3.15-.83a4.65 4.65 0 0 0-3.91 2.38c-1.68 2.91-.43 7.2 1.19 9.56.8 1.15 1.74 2.44 2.98 2.4 1.2-.05 1.65-.77 3.1-.77s1.86.77 3.12.74c1.29-.02 2.1-1.16 2.88-2.32a10.4 10.4 0 0 0 1.31-2.69 4.13 4.13 0 0 1-2.47-3.88zM11.17 3.46A4.17 4.17 0 0 0 12.14 0a4.25 4.25 0 0 0-2.75 1.42 3.98 3.98 0 0 0-1 2.89 3.52 3.52 0 0 0 2.78-0.85z"/>
            </svg>
            <span style={{
              color: '#fff',
              fontFamily: '-apple-system, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif',
              fontSize: '20px',
              fontWeight: 400,
              letterSpacing: '0.4px',
            }}>Pay</span>
          </button>
        )}
        {!applePayAvailable && (
          <div ref={applePayRef} style={{ display: 'none' }} />
        )}
        {googlePayAvailable && !googlePayTokenizeOnly && (
          <div
            ref={googlePayRef}
            className="min-h-[40px]"
            onClick={onGooglePayClick}
          />
        )}
        {!googlePayAvailable && (
          <div ref={googlePayRef} style={{ display: 'none' }} />
        )}
        {isWalletProcessing && (
          <div className="flex items-center justify-center py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-2" />
            <span className="text-sm text-muted-foreground">Processing wallet payment...</span>
          </div>
        )}
      </div>

      {hasWalletOptions && (
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              Or pay with card
            </span>
          </div>
        </div>
      )}

      {savedCards.length > 0 && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant={cardMode === 'saved' ? 'default' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={() => {
              if (cardMode === 'saved') return;
              onCleanupCard();
              setIsSquareReady(false);
              initializationAttempted.current = false;
              setCardMode('saved');
              setSelectedSavedCardId(savedCards[0].id);
            }}
          >
            <Wallet className="h-4 w-4 mr-1" />
            Saved Card
          </Button>
          <Button
            type="button"
            variant={cardMode === 'new' ? 'default' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={() => {
              if (cardMode === 'new') return;
              onCleanupCard();
              setIsSquareReady(false);
              initializationAttempted.current = false;
              setCardMode('new');
              setSelectedSavedCardId('');
            }}
          >
            <CreditCard className="h-4 w-4 mr-1" />
            New Card
          </Button>
        </div>
      )}

      {cardMode === 'saved' && savedCards.length > 0 && (
        <div className="space-y-3">
          <Select
            value={selectedSavedCardId}
            onValueChange={setSelectedSavedCardId}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a saved card" />
            </SelectTrigger>
            <SelectContent>
              {savedCards.map((sc) => (
                <SelectItem key={sc.id} value={sc.id}>
                  {sc.brand} •••• {sc.last4} (exp {String(sc.expMonth).padStart(2, '0')}/{sc.expYear})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Alert>
            <Wallet className="h-4 w-4" />
            <AlertDescription>
              Payment will be charged to the selected saved card.
            </AlertDescription>
          </Alert>
        </div>
      )}

      <div className={cardMode === 'saved' && savedCards.length > 0 ? 'hidden' : ''}>
        <div className="min-h-[200px] border rounded-lg bg-card">
          <div ref={cardContainerRef} className="p-4" />
          {!isSquareReady && (
            <div className="flex items-center justify-center p-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="ml-2 text-sm text-muted-foreground">
                Loading credit card form...
              </p>
            </div>
          )}
        </div>
        
        {squareError && (
          <div className="p-3 text-sm border border-destructive bg-destructive/10 text-destructive rounded-md">
            <p><strong>Credit Card Form Error:</strong> {squareError}</p>
            <p className="mt-1 text-xs">Consider using Cash or Check payment instead.</p>
          </div>
        )}
        
        <div className="flex items-center space-x-2">
          <FormField
            control={form.control}
            name="storeCard"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                <FormControl>
                  <Checkbox
                    id="storeCard"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <label 
                  htmlFor="storeCard" 
                  className="text-sm font-medium leading-none cursor-pointer"
                >
                  Save card for future payments
                </label>
              </FormItem>
            )}
          />
        </div>
      </div>
    </div>
  );
}
