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
            className="apple-pay-button w-full"
            style={{
              WebkitAppearance: 'none',
              appearance: 'none',
              backgroundColor: '#000',
              border: 'none',
              borderRadius: '6px',
              height: '44px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              opacity: isWalletProcessing ? 0.5 : 1,
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="58" height="25" viewBox="0 0 165.52 105.97" fill="white">
              <path d="M31.54 14.2a10.74 10.74 0 0 0 2.47-7.7 10.93 10.93 0 0 0-7.13 3.69 10.23 10.23 0 0 0-2.53 7.42 9.04 9.04 0 0 0 7.19-3.41zM33.97 21.48c-3.98-.23-7.37 2.26-9.26 2.26s-4.81-2.14-7.95-2.08a11.76 11.76 0 0 0-10 6.05c-4.27 7.4-1.1 18.36 3.03 24.38 2.04 2.95 4.44 6.26 7.62 6.14 3.03-.12 4.21-1.97 7.89-1.97s4.74 1.97 7.95 1.91c3.29-.06 5.37-2.95 7.41-5.93a26.6 26.6 0 0 0 3.35-6.87 11.08 11.08 0 0 1-6.63-10.12 11.24 11.24 0 0 1 5.37-9.44 11.52 11.52 0 0 0-9.08-4.92l-.7.49z"/>
              <path d="M76.65 4.56c12.06 0 20.45 8.3 20.45 20.39S88.83 45.4 76.53 45.4h-13.3v21.17H54.6V4.56zm-13.42 33h11.04c8.4 0 13.18-4.53 13.18-12.57S82.67 12.4 74.33 12.4H63.23zM99.1 53.04c0-7.95 6.09-12.82 16.88-13.42l12.45-.72v-3.5c0-5.06-3.41-8.09-9.11-8.09-5.37 0-8.81 2.7-9.62 6.87h-7.68c.48-8.06 7.14-14 17.66-14 10.37 0 16.94 5.49 16.94 14.12v29.55h-7.92v-7.07h-.18c-2.32 4.69-7.44 7.71-12.72 7.71-7.89 0-13.18-4.87-13.18-11.93l-.52.48zm29.33-4.06V45.4l-11.21.66c-6.33.42-9.92 3.17-9.92 7.53s3.77 7.17 8.93 7.17c6.69 0 12.2-4.57 12.2-11.78zM143.12 84.98c-1.07 3.53-4.87 11.99-10.61 11.99-1.16 0-2.14-.18-2.14-.18v-7.17s.96.12 1.61.12c2.5 0 3.89-1.07 5.31-4.63l.96-2.5-16.22-43.54h8.69l11.69 36.29h.18l11.69-36.29h8.45z"/>
            </svg>
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
