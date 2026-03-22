import { FC, useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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
import { formatCurrency } from "@/lib/utils";
import type { SavedCard } from "@shared/schema";

interface BowlerPaymentDialogProps {
  payDialogType: 'pastdue' | 'remaining' | null;
  onClose: () => void;
  amountPastDue: number;
  remainingBalance: number;
  savedCards: SavedCard[];
  cardMode: 'new' | 'saved';
  setCardMode: (mode: 'new' | 'saved') => void;
  selectedSavedCardId: string;
  setSelectedSavedCardId: (id: string) => void;
  storeCard: boolean;
  setStoreCard: (v: boolean) => void;
  isInitialized: boolean;
  isSubmitting: boolean;
  onSubmit: () => void;
  initializeCard: (el: HTMLDivElement) => void;
  cleanupCard: () => void;
}

export const BowlerPaymentDialog: FC<BowlerPaymentDialogProps> = ({
  payDialogType,
  onClose,
  amountPastDue,
  remainingBalance,
  savedCards,
  cardMode,
  setCardMode,
  selectedSavedCardId,
  setSelectedSavedCardId,
  storeCard,
  setStoreCard,
  isInitialized,
  isSubmitting,
  onSubmit,
  initializeCard,
  cleanupCard,
}) => {
  const cardCallbackRef = useRef<(el: HTMLDivElement | null) => void>(() => {});
  cardCallbackRef.current = (el: HTMLDivElement | null) => {
    if (el && payDialogType && cardMode === 'new') {
      initializeCard(el);
    }
  };

  const dialogAmount = payDialogType === 'pastdue' ? amountPastDue : remainingBalance;

  return (
    <Dialog open={!!payDialogType} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{payDialogType === 'pastdue' ? 'Pay Past Due Amount' : 'Pay Remaining Balance'}</DialogTitle>
          <DialogDescription>
            {payDialogType === 'pastdue'
              ? `Pay your outstanding balance of ${formatCurrency(amountPastDue)}`
              : `Pay off your remaining season balance of ${formatCurrency(remainingBalance)}`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="rounded-md border p-4 bg-muted/50">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Amount</span>
              <span className="text-lg font-bold">{formatCurrency(dialogAmount)}</span>
            </div>
          </div>

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
            <div className="space-y-3">
              <label className="text-sm font-medium mb-2 block">Card Details</label>
              <div
                ref={(el) => cardCallbackRef.current(el)}
                className="min-h-[80px] rounded-md border p-3"
              />
              <div className="flex items-center space-x-3">
                <Checkbox
                  id="store-card-history"
                  checked={storeCard}
                  onCheckedChange={(checked) => setStoreCard(checked === true)}
                />
                <Label htmlFor="store-card-history" className="text-sm cursor-pointer">
                  Save this card for future payments
                </Label>
              </div>
            </div>
          )}

          <Button
            onClick={onSubmit}
            disabled={
              (cardMode === 'new' && !isInitialized) ||
              (cardMode === 'saved' && !selectedSavedCardId) ||
              isSubmitting
            }
            className="w-full"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <CreditCard className="mr-2 h-4 w-4" />
                Pay {formatCurrency(dialogAmount)}
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
