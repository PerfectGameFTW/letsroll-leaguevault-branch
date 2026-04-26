import { useCallback } from "react";
import { useLocation } from "wouter";
import { createPayment, tokenizeCard } from "@/lib/square";
import { useToast } from "@/hooks/use-toast";
import { queryClient, csrfFetch } from '@/lib/queryClient';
import { formatCurrency } from "@/lib/utils";
import {
  isProviderNotConfiguredError,
  providerNotConfiguredToast,
  makeApiError,
} from "@/lib/provider-not-configured";
import type { League, Bowler } from "@shared/schema";
import type { SquareCard } from "@/hooks/use-square-payment";
import type { CardPointeCard } from "@/hooks/use-cardpointe-payment";

type PaymentCard = SquareCard | CardPointeCard | null;

// Human-friendly cadence label for auto-pay toast copy (avoids
// interpolating raw schedule keys into user-facing text).
function scheduleLabel(schedule: 'weekly' | 'custom'): string {
  return schedule === 'weekly' ? 'weekly' : 'recurring';
}

interface UseBowlerPaymentSubmitOptions {
  league: League;
  bowler: Bowler;
  weeklyFee: number;
  card: PaymentCard;
  cardMode: 'new' | 'saved';
  selectedSavedCardId: string;
  selectedSchedule: 'weekly' | 'custom';
  storeCard: boolean;
  includeFinalTwoWeeks: boolean;
  showFinalTwoWeeksWarning: boolean;
  // optional inline email captured at checkout when the
  // bowler has none on file. Threaded to the server so Square's
  // hosted receipt fires for this charge.
  buyerEmail?: string;
  financials: {
    fullSeasonAmount: number;
    finalTwoWeeks: { amount: number; dueByWeek: number; isPaid: boolean };
    amountPastDue: number;
  };
  calculateTotalAmount: () => number;
  setIsSubmitting: (v: boolean) => void;
  setShowFinalTwoWeeksWarning: (v: boolean) => void;
  setIncludeFinalTwoWeeks: (v: boolean) => void;
  setShowPaymentSetup: (v: boolean) => void;
}

export function useBowlerPaymentSubmit({
  league,
  bowler,
  weeklyFee,
  card,
  cardMode,
  selectedSavedCardId,
  selectedSchedule,
  storeCard,
  includeFinalTwoWeeks,
  showFinalTwoWeeksWarning,
  buyerEmail,
  financials,
  calculateTotalAmount,
  setIsSubmitting,
  setShowFinalTwoWeeksWarning,
  setIncludeFinalTwoWeeks,
  setShowPaymentSetup,
}: UseBowlerPaymentSubmitOptions) {
  const { toast } = useToast();
  const [, navigate] = useLocation();

  // Local helper that lets the inline csrfFetch calls below propagate
  // the structured `error.code` (specifically PROVIDER_NOT_CONFIGURED)
  // up to the catch block — the previous code threw a bare-message
  // Error which dropped that signal.
  const throwApiErrorIfNotOk = async (
    response: Response,
    body: unknown,
    fallback: string,
  ) => {
    if (response.ok) return;
    throw makeApiError(body, response.status, fallback);
  };

  return useCallback(async () => {
    if (cardMode === 'new' && !card) {
      toast({ title: "Payment Setup Error", description: "Please enter your card details before proceeding.", variant: "destructive" });
      return;
    }
    if (cardMode === 'saved' && !selectedSavedCardId) {
      toast({ title: "Payment Setup Error", description: "Please select a saved card.", variant: "destructive" });
      return;
    }

    const isUpfront = league.paymentMode === 'upfront';
    const isAutoPay = !isUpfront && selectedSchedule !== 'custom';
    const finalTwoWeeksUnpaid = !financials.finalTwoWeeks.isPaid && financials.finalTwoWeeks.amount > 0;

    if (!isUpfront && isAutoPay && finalTwoWeeksUnpaid && !includeFinalTwoWeeks && !showFinalTwoWeeksWarning) {
      setShowFinalTwoWeeksWarning(true);
      return;
    }

    try {
      setIsSubmitting(true);
      setShowFinalTwoWeeksWarning(false);

      if (isUpfront) {
        const upfrontAmount = financials.fullSeasonAmount;
        let paymentCardId: string;

        if (cardMode === 'saved' && selectedSavedCardId) {
          paymentCardId = selectedSavedCardId;
        } else {
          const token = await tokenizeCard(card!);
          const saveResponse = await csrfFetch(`/api/payments-provider/cards/${bowler.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourceId: token }),
          });
          const saveData = await saveResponse.json();
          await throwApiErrorIfNotOk(saveResponse, saveData, 'Your card could not be saved. Please try again.');
          if (!saveData.data?.savedCardId) {
            throw new Error(saveData.error?.message || 'Your card could not be saved. Please try again.');
          }
          paymentCardId = saveData.data.savedCardId;
          queryClient.invalidateQueries({ queryKey: [`/api/payments-provider/cards/${bowler.id}`] });
        }

        const scheduleResponse = await csrfFetch('/api/payment-schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bowlerId: bowler.id,
            leagueId: league.id,
            frequency: 'upfront',
            amount: upfrontAmount,
            nextPaymentDate: new Date(),
            paymentCardId,
            includeFinalTwoWeeks: false,
          }),
        });
        if (!scheduleResponse.ok) {
          const scheduleData = await scheduleResponse.json();
          throw new Error(scheduleData.error?.message || 'Failed to set up payment schedule');
        }
        queryClient.invalidateQueries({ queryKey: [`/api/payment-schedules/${bowler.id}/${league.id}`] });
        toast({
          title: "Payment Scheduled",
          description: `Your card has been saved and your full season payment of ${formatCurrency(upfrontAmount)} will be processed momentarily.`,
        });
        setShowPaymentSetup(false);
        queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
        return;
      }
      
      const amount = calculateTotalAmount();
      const hasOutstandingBalance = financials.amountPastDue > 0;
      let paymentCardId: string | null = null;
      let paymentWasCharged = false;

      if (isAutoPay && !hasOutstandingBalance) {
        if (cardMode === 'saved' && selectedSavedCardId) {
          paymentCardId = selectedSavedCardId;
        } else {
          const token = await tokenizeCard(card!);
          const saveResponse = await csrfFetch(`/api/payments-provider/cards/${bowler.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourceId: token }),
          });
          const saveData = await saveResponse.json();
          await throwApiErrorIfNotOk(saveResponse, saveData, 'Failed to save card');
          paymentCardId = saveData.data?.savedCardId || null;
          if (!paymentCardId) {
            throw new Error('Your card could not be saved for auto-pay. Please try again.');
          }
          queryClient.invalidateQueries({ queryKey: [`/api/payments-provider/cards/${bowler.id}`] });
        }
      } else if (cardMode === 'saved' && selectedSavedCardId) {
        const trimmedBuyerEmail = (buyerEmail ?? '').trim();
        const response = await csrfFetch('/api/payments-provider/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceId: selectedSavedCardId,
            amount,
            bowlerId: bowler.id,
            leagueId: league.id,
            storeCard: false,
            ...(trimmedBuyerEmail && !bowler.email ? { buyerEmail: trimmedBuyerEmail } : {}),
          }),
        });
        const responseData = await response.json();
        await throwApiErrorIfNotOk(response, responseData, 'Payment failed');
        paymentCardId = selectedSavedCardId;
        paymentWasCharged = true;
      } else {
        const shouldStore = isAutoPay || storeCard;
        const trimmedBuyerEmail = (buyerEmail ?? '').trim();
        const overrideEmail = trimmedBuyerEmail && !bowler.email ? trimmedBuyerEmail : undefined;
        const paymentResult = await createPayment(amount, card!, bowler.id, league.id, shouldStore, overrideEmail);
        if (shouldStore) {
          queryClient.invalidateQueries({ queryKey: [`/api/payments-provider/cards/${bowler.id}`] });
        }
        if (isAutoPay) {
          paymentCardId = paymentResult.savedCardId || null;
          if (!paymentCardId) {
            throw new Error('Your card could not be saved for auto-pay. Please try again.');
          }
        }
        paymentWasCharged = true;
      }

      if (isAutoPay && paymentCardId) {
        const recurringAmount = weeklyFee;
        const scheduleResponse = await csrfFetch('/api/payment-schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bowlerId: bowler.id,
            leagueId: league.id,
            frequency: selectedSchedule,
            amount: recurringAmount,
            nextPaymentDate: new Date(),
            paymentCardId,
            includeFinalTwoWeeks,
          }),
        });
        if (!scheduleResponse.ok) {
          const scheduleData = await scheduleResponse.json();
          throw new Error(scheduleData.error?.message || 'Failed to set up payment schedule');
        }
        queryClient.invalidateQueries({ queryKey: [`/api/payment-schedules/${bowler.id}/${league.id}`] });
      }

      if (isAutoPay) {
        const cadence = scheduleLabel(selectedSchedule);
        toast({
          title: "Auto-Pay Activated",
          description: paymentWasCharged
            ? `Paid ${formatCurrency(amount)} today and ${cadence} auto-pay is now active for future weeks.`
            : `Your card has been saved and ${cadence} auto-pay is now active.`,
        });
      } else {
        toast({
          title: "Payment Successful",
          description: includeFinalTwoWeeks
            ? `Payment of ${formatCurrency(amount)} processed (includes Final 2 Weeks).`
            : `Your payment of ${formatCurrency(amount)} has been processed.`,
        });
      }
      
      setIncludeFinalTwoWeeks(false);
      setShowPaymentSetup(false);
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
    } catch (error) {
      console.error('[Payment Error]:', error);
      if (isProviderNotConfiguredError(error)) {
        toast(providerNotConfiguredToast({
          navigate,
          locationId: league.locationId ?? null,
        }));
        return;
      }
      let errorMessage = "Unable to process payment. Please try again.";
      if (typeof error === 'string') {
        errorMessage = error;
      } else if (error instanceof Error) {
        try {
          const parsed = JSON.parse(error.message);
          errorMessage = parsed.error?.message || error.message;
        } catch {
          errorMessage = error.message;
        }
      }
      toast({ title: "Payment Failed", description: errorMessage, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  }, [
    card, cardMode, selectedSavedCardId, league, bowler, weeklyFee,
    selectedSchedule, storeCard, includeFinalTwoWeeks, showFinalTwoWeeksWarning,
    buyerEmail, financials, calculateTotalAmount, toast, navigate,
    setIsSubmitting, setShowFinalTwoWeeksWarning, setIncludeFinalTwoWeeks, setShowPaymentSetup,
  ]);
}
