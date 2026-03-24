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
            className="w-full h-10 rounded-md bg-black text-white flex items-center justify-center gap-2 hover:bg-gray-900 transition-colors disabled:opacity-50"
            style={{ WebkitAppearance: 'none', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white">
              <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
            </svg>
            <span style={{ fontSize: '14px', fontWeight: 500 }}>Pay</span>
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
