import { FC, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, CreditCard, Wallet } from "lucide-react";
import type { SavedCard } from "@shared/schema";

interface PaymentSetupCardInputProps {
  savedCards: SavedCard[];
  cardMode: 'new' | 'saved';
  setCardMode: (mode: 'new' | 'saved') => void;
  selectedSavedCardId: string;
  setSelectedSavedCardId: (id: string) => void;
  cardContainerRef: RefObject<HTMLDivElement>;
  isInitialized: boolean;
  squareError: string | null;
  storeCard: boolean;
  setStoreCard: (v: boolean) => void;
  showStoreCardOption: boolean;
  cleanupCard: () => void;
  applePayAvailable: boolean;
  googlePayAvailable: boolean;
  applePayRef: RefObject<HTMLDivElement>;
  googlePayRef: RefObject<HTMLDivElement>;
  onApplePayClick: () => void;
  onGooglePayClick: () => void;
  isWalletProcessing: boolean;
  applePayTokenizeOnly: boolean;
  googlePayTokenizeOnly: boolean;
}

export const PaymentSetupCardInput: FC<PaymentSetupCardInputProps> = ({
  savedCards,
  cardMode,
  setCardMode,
  selectedSavedCardId,
  setSelectedSavedCardId,
  cardContainerRef,
  isInitialized,
  squareError,
  storeCard,
  setStoreCard,
  showStoreCardOption,
  cleanupCard,
  applePayAvailable,
  googlePayAvailable,
  applePayRef,
  googlePayRef,
  onApplePayClick,
  onGooglePayClick,
  isWalletProcessing,
  applePayTokenizeOnly,
  googlePayTokenizeOnly,
}) => {
  const showWallet = applePayAvailable || googlePayAvailable;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">Payment Information</h3>
        <p className="text-sm text-muted-foreground">
          {savedCards.length > 0
            ? "Use a saved card or enter new card details"
            : "Enter your card details (securely processed by Square)"}
        </p>
      </div>

      {applePayAvailable && !applePayTokenizeOnly && (
        <div
          ref={applePayRef}
          onClick={onApplePayClick}
          className="min-h-[48px] cursor-pointer"
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
            height: '48px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            opacity: isWalletProcessing ? 0.5 : 1,
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="65" height="28" viewBox="0 0 165.52 105.97" fill="white">
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
          onClick={onGooglePayClick}
          className="min-h-[48px] cursor-pointer"
        />
      )}
      {!googlePayAvailable && (
        <div ref={googlePayRef} style={{ display: 'none' }} />
      )}
      {isWalletProcessing && (
        <div className="flex items-center justify-center gap-2 py-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm text-muted-foreground">Processing wallet payment...</span>
        </div>
      )}
      {showWallet && (
        <div className="relative flex items-center gap-4 py-2">
          <div className="flex-1 border-t" />
          <span className="text-xs text-muted-foreground">or pay with card</span>
          <div className="flex-1 border-t" />
        </div>
      )}

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
              if (cardMode === 'new') return;
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
        <>
          <div ref={cardContainerRef} className="min-h-[200px] border rounded-lg bg-card p-4">
            {!isInitialized && (
              <div className="flex items-center justify-center p-4">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <p className="ml-2 text-sm text-muted-foreground">
                  Loading credit card form...
                </p>
              </div>
            )}
          </div>
          {showStoreCardOption && (
            <div className="flex items-center space-x-3">
              <Checkbox
                id="store-card-status"
                checked={storeCard}
                onCheckedChange={(checked) => setStoreCard(checked === true)}
              />
              <Label htmlFor="store-card-status" className="text-sm cursor-pointer">
                Save this card for future payments
              </Label>
            </div>
          )}
        </>
      )}

      {squareError && cardMode === 'new' && (
        <div className="p-3 text-sm border border-destructive bg-destructive/10 text-destructive rounded-md">
          <p><strong>Credit Card Form Error:</strong> {squareError}</p>
          <p className="mt-1 text-xs">Consider using Cash or Check payment instead.</p>
        </div>
      )}
    </div>
  );
};
