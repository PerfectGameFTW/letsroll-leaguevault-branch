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
}: PaymentCreditCardSectionProps) {
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
