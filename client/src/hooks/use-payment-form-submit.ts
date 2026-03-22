import { UseFormReturn } from "react-hook-form";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { csrfFetch } from "@/lib/queryClient";
import type { InsertPayment } from "@shared/schema";
import type { SquareCard } from "@/hooks/use-square-payment";

interface UsePaymentFormSubmitOptions {
  form: UseFormReturn<InsertPayment>;
  card: SquareCard | null;
  cardMode: 'new' | 'saved';
  selectedSavedCardId: string;
  setPaymentError: (error: string | null) => void;
  onClose: () => void;
}

export function usePaymentFormSubmit({
  form,
  card,
  cardMode,
  selectedSavedCardId,
  setPaymentError,
  onClose,
}: UsePaymentFormSubmitOptions) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const onSubmit = async (data: InsertPayment) => {
    try {
      setPaymentError(null);

      if (data.type === 'credit_card') {
        if (cardMode === 'saved' && selectedSavedCardId) {
          const response = await csrfFetch('/api/square/payments', {
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

        const tokenizationOptions = data.storeCard ? {
          cardOnFile: true,
          verificationMethod: 'EXTERNAL',
          verificationDetails: {
            amount: data.amount.toString(),
            currencyCode: 'USD',
            intent: 'STORE'
          }
        } : undefined;
        
        const result = await card.tokenize(tokenizationOptions);

        if (result.status !== 'OK' || !result.token) {
          const errors = result.errors || [];
          const errorMessage = errors.map((e: { message: string }) => e.message).join(', ') || 'Card validation failed';
          throw new Error(errorMessage);
        }

        const response = await csrfFetch('/api/square/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceId: result.token,
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
          queryClient.invalidateQueries({ queryKey: [`/api/square/cards/${data.bowlerId}`] });
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
