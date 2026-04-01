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
            : "Enter your card details securely"}
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
          style={{
            WebkitAppearance: 'none',
            appearance: 'none',
            backgroundColor: '#000',
            border: 'none',
            borderRadius: '5px',
            width: '100%',
            height: '48px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '2px',
            padding: 0,
            opacity: isWalletProcessing ? 0.5 : 1,
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="19" height="24" viewBox="0 0 17 20" fill="white" style={{ position: 'relative', top: '-1px' }}>
            <path d="M13.55 10.63a4.27 4.27 0 0 1 2.04-3.59 4.4 4.4 0 0 0-3.46-1.87c-1.46-.15-2.88.87-3.63.87s-1.91-.85-3.15-.83a4.65 4.65 0 0 0-3.91 2.38c-1.68 2.91-.43 7.2 1.19 9.56.8 1.15 1.74 2.44 2.98 2.4 1.2-.05 1.65-.77 3.1-.77s1.86.77 3.12.74c1.29-.02 2.1-1.16 2.88-2.32a10.4 10.4 0 0 0 1.31-2.69 4.13 4.13 0 0 1-2.47-3.88zM11.17 3.46A4.17 4.17 0 0 0 12.14 0a4.25 4.25 0 0 0-2.75 1.42 3.98 3.98 0 0 0-1 2.89 3.52 3.52 0 0 0 2.78-0.85z"/>
          </svg>
          <span style={{
            color: '#fff',
            fontFamily: '-apple-system, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif',
            fontSize: '22px',
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
