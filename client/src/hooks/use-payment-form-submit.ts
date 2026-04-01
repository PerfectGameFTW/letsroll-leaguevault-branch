import { UseFormReturn } from "react-hook-form";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { csrfFetch } from "@/lib/queryClient";
import type { InsertPayment } from "@shared/schema";
import type { SquareCard } from "@/hooks/use-square-payment";
import type { CardPointeCard } from "@/hooks/use-cardpointe-payment";

export type PaymentCard = SquareCard | CardPointeCard | null;

interface UsePaymentFormSubmitOptions {
  form: UseFormReturn<InsertPayment>;
  card: PaymentCard;
  cardMode: 'new' | 'saved';
  selectedSavedCardId: string;
  setPaymentError: (error: string | null) => void;
  onClose: () => void;
  isCardPointe?: boolean;
}

export function usePaymentFormSubmit({
  form,
  card,
  cardMode,
  selectedSavedCardId,
  setPaymentError,
  onClose,
  isCardPointe = false,
}: UsePaymentFormSubmitOptions) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const onSubmit = async (data: InsertPayment) => {
    try {
      setPaymentError(null);

      if (data.type === 'credit_card') {
        if (cardMode === 'saved' && selectedSavedCardId) {
          const response = await csrfFetch('/api/payments-provider/payments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sourceId: selectedSavedCardId,
              amount: data.amount,
              bowlerId: data.bowlerId,
              leagueId: data.leagueId,
              storeCard: false,
            }),
          });

          const responseData = await response.json();
          if (!response.ok) {
            throw new Error(responseData.error?.message || 'Failed to process payment');
          }

          toast({ title: "Success", description: "Payment processed with saved card" });
          queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
          onClose();
          return;
        }

        if (!card) {
          throw new Error('Credit card form not initialized');
        }

        let sourceToken: string;
        const isSquareCard = 'tokenize' in card && card.tokenize.length !== 0 || ('destroy' in card && 'attach' in card);
        const cardAny = card as any;

        if (cardAny.tokenize) {
          const result = await cardAny.tokenize(
            isSquareCard && data.storeCard ? {
              cardOnFile: true,
              verificationMethod: 'EXTERNAL',
              verificationDetails: {
                amount: data.amount.toString(),
                currencyCode: 'USD',
                intent: 'STORE'
              }
            } : undefined
          );

          if ('status' in result) {
            if (result.status !== 'OK' || !result.token) {
              const errors = result.errors || [];
              const errorMessage = errors.map((e: { message: string }) => e.message).join(', ') || 'Card validation failed';
              throw new Error(errorMessage);
            }
            sourceToken = result.token;
          } else {
            sourceToken = result.token;
          }
        } else {
          throw new Error('Card tokenization not available');
        }

        const response = await csrfFetch('/api/payments-provider/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceId: sourceToken,
            amount: data.amount,
            bowlerId: data.bowlerId,
            leagueId: data.leagueId,
            storeCard: data.storeCard || false,
          }),
        });

        const responseData = await response.json();
        if (!response.ok) {
          throw new Error(responseData.error?.message || 'Failed to process payment');
        }

        toast({ title: "Success", description: "Payment processed successfully" });
        if (data.storeCard) {
          queryClient.invalidateQueries({ queryKey: [`/api/payments-provider/cards/${data.bowlerId}`] });
        }
        queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
        onClose();
        return;
      }

      const response = await csrfFetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(responseData.error?.message || 'Failed to process payment');
      }

      toast({ title: "Success", description: "Payment recorded successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      onClose();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to process payment";
      setPaymentError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  return onSubmit;
}
