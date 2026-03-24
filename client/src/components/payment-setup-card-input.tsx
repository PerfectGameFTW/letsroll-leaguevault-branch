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
  walletDebugStatus: string;
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
  walletDebugStatus,
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

      <div
        ref={applePayRef}
        onClick={applePayAvailable ? onApplePayClick : undefined}
        className={applePayAvailable ? "min-h-[48px] cursor-pointer" : ""}
        style={{ display: (applePayAvailable && applePayRef.current?.children.length) ? 'block' : 'none' }}
      />
      {applePayAvailable && (
        <button
          type="button"
          onClick={onApplePayClick}
          disabled={isWalletProcessing}
          className="w-full h-12 rounded-md bg-black text-white flex items-center justify-center gap-2 hover:bg-gray-900 transition-colors disabled:opacity-50"
          style={{ WebkitAppearance: 'none', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="white">
            <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
          </svg>
          <span style={{ fontSize: '16px', fontWeight: 500 }}>Pay</span>
        </button>
      )}
      <div
        ref={googlePayRef}
        onClick={googlePayAvailable ? onGooglePayClick : undefined}
        className={googlePayAvailable ? "min-h-[48px] cursor-pointer" : ""}
        style={{ display: googlePayAvailable ? 'block' : 'none' }}
      />
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

      {walletDebugStatus && (
        <div className="p-2 text-xs bg-yellow-50 border border-yellow-200 rounded text-yellow-800 dark:bg-yellow-900/30 dark:border-yellow-700 dark:text-yellow-200">
          <strong>Wallet Debug:</strong> {walletDebugStatus}
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
