import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { subDays, differenceInWeeks } from "date-fns";
import type { Payment, League } from "@shared/schema";

interface PaymentEntry {
  bowlerId: number;
  type: string;
  amount: string;
  checkNumber?: string;
}

export function useWeeklyPayments(leagueId: number) {
  const { toast } = useToast();
  const [paymentToDelete, setPaymentToDelete] = useState<number | null>(null);
  const [paymentEntries, setPaymentEntries] = useState<{ [key: number]: PaymentEntry }>({});
  const [editingPayment, setEditingPayment] = useState<{id: number, amount: string} | null>(null);

  const handlePaymentTypeChange = useCallback((bowlerId: number, type: string) => {
    setPaymentEntries(prev => ({
      ...prev,
      [bowlerId]: {
        ...prev[bowlerId],
        bowlerId,
        type,
      }
    }));
  }, []);

  const handleAmountChange = useCallback((bowlerId: number, amount: string) => {
    setPaymentEntries(prev => ({
      ...prev,
      [bowlerId]: {
        ...prev[bowlerId],
        bowlerId,
        amount: amount.replace(/[^0-9.]/g, ''),
      }
    }));
  }, []);

  const handleCheckNumberChange = useCallback((bowlerId: number, checkNumber: string) => {
    setPaymentEntries(prev => ({
      ...prev,
      [bowlerId]: {
        ...prev[bowlerId],
        bowlerId,
        checkNumber,
      }
    }));
  }, []);

  const submitPaymentMutation = useMutation({
    mutationFn: async (payment: {
      bowlerId: number;
      type: string;
      amount: number;
      weekOf: Date;
      leagueId: number;
      status: string;
      checkNumber?: string;
    }) => {
      const response = await apiRequest("POST", "/api/payments", {
        ...payment,
        weekOf: payment.weekOf.toISOString(),
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      toast({
        title: "Payment recorded",
        description: "The payment has been successfully recorded.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error recording payment",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmitPayment = useCallback(async (bowlerId: number, selectedDate?: Date) => {
    const entry = paymentEntries[bowlerId];
    if (!entry?.type || !entry?.amount || !selectedDate) return;

    const amountInCents = Math.round(parseFloat(entry.amount) * 100);
    if (isNaN(amountInCents)) return;

    await submitPaymentMutation.mutate({
      bowlerId,
      leagueId,
      type: entry.type,
      amount: amountInCents,
      weekOf: selectedDate,
      status: 'paid',
      checkNumber: entry.type === 'check' ? entry.checkNumber : undefined,
    });

    setPaymentEntries(prev => {
      const newEntries = { ...prev };
      delete newEntries[bowlerId];
      return newEntries;
    });
  }, [paymentEntries, leagueId, submitPaymentMutation]);

  const deletePaymentMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("DELETE", `/api/payments/${id}`);
      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }
      return id;
    },
    onMutate: async (deletedId) => {
      await queryClient.cancelQueries({ queryKey: ["/api/payments"] });
      const previousPayments = queryClient.getQueryData<{ data: Payment[] }>(["/api/payments"]);

      if (previousPayments?.data) {
        queryClient.setQueryData<{ data: Payment[] }>(["/api/payments"], {
          data: previousPayments.data.filter(payment => payment.id !== deletedId)
        });
      }
      return { previousPayments };
    },
    onError: (error: Error, _, context) => {
      if (context?.previousPayments) {
        queryClient.setQueryData(["/api/payments"], context.previousPayments);
      }
      toast({
        title: "Error deleting payment",
        description: error.message,
        variant: "destructive",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      setPaymentToDelete(null);
      toast({
        title: "Payment deleted",
        description: "The payment has been successfully deleted.",
      });
    },
  });

  const handleDelete = useCallback(async (id: number) => {
    try {
      await deletePaymentMutation.mutateAsync(id);
    } catch (error) {
      console.error('[WeeklyPayments] Error in handleDelete:', error);
    }
  }, [deletePaymentMutation]);

  const updatePaymentMutation = useMutation({
    mutationFn: async ({ id, amount }: { id: number; amount: number }) => {
      const response = await apiRequest("PATCH", `/api/payments/${id}`, {
        amount,
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      toast({
        title: "Success",
        description: "Payment amount has been updated.",
      });
      setEditingPayment(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error updating payment",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleStartEdit = useCallback((payment: Payment) => {
    setEditingPayment({
      id: payment.id,
      amount: (payment.amount / 100).toFixed(2),
    });
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingPayment(null);
  }, []);

  const handleSaveEdit = useCallback(async (id: number) => {
    if (!editingPayment) return;

    const amount = editingPayment.amount.trim();
    if (!amount || isNaN(parseFloat(amount))) {
      toast({
        title: "Invalid amount",
        description: "Please enter a valid number",
        variant: "destructive",
      });
      return;
    }

    const amountInCents = Math.round(parseFloat(amount) * 100);

    await updatePaymentMutation.mutate({
      id,
      amount: amountInCents,
    });
  }, [editingPayment, updatePaymentMutation, toast]);

  return {
    paymentEntries,
    paymentToDelete,
    setPaymentToDelete,
    editingPayment,
    setEditingPayment,
    handlePaymentTypeChange,
    handleAmountChange,
    handleCheckNumberChange,
    handleSubmitPayment,
    handleDelete,
    handleStartEdit,
    handleCancelEdit,
    handleSaveEdit,
    submitPaymentMutation,
    deletePaymentMutation,
    updatePaymentMutation,
  };
}

export function getNearestBowlingDay(date: Date, weekDay: string): Date {
  const weekDayMap: { [key: string]: number } = {
    'sunday': 0,
    'monday': 1,
    'tuesday': 2,
    'wednesday': 3,
    'thursday': 4,
    'friday': 5,
    'saturday': 6
  };

  const targetDay = weekDayMap[weekDay.toLowerCase()];
  const currentDay = date.getDay();

  if (currentDay === targetDay) {
    return date;
  }

  let daysToSubtract = currentDay - targetDay;
  if (daysToSubtract <= 0) {
    daysToSubtract += 7;
  }

  return subDays(date, daysToSubtract);
}

export function getWeekNumber(date: Date, league: League | undefined): number {
  if (!league?.seasonStart) return 0;
  const seasonStart = new Date(league.seasonStart);
  const weeksDiff = differenceInWeeks(date, seasonStart);
  return weeksDiff + 1;
}

export function isDateDisabled(date: Date, league: League | undefined): boolean {
  if (!league?.weekDay) return false;

  const weekDayMap: { [key: string]: number } = {
    'sunday': 0,
    'monday': 1,
    'tuesday': 2,
    'wednesday': 3,
    'thursday': 4,
    'friday': 5,
    'saturday': 6
  };

  const bowlingDayNumber = weekDayMap[league.weekDay.toLowerCase()];
  return date.getDay() !== bowlingDayNumber;
}
