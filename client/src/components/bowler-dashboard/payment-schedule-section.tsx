```typescript
// Previous imports remain the same

const cancelScheduleMutation = useMutation({
  mutationFn: async () => {
    if (!bowler || !selectedLeague) {
      throw new Error("Missing bowler or league information");
    }

    if (!paymentScheduleResponse?.data?.id) {
      throw new Error("No active payment schedule found");
    }

    try {
      const response = await apiRequest(
        "DELETE",
        `/api/payments/schedules/${paymentScheduleResponse.data.id}`
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to cancel automatic payments');
      }

      return await response.json();
    } catch (error) {
      console.error('[PaymentScheduleSection] Cancel payments error:', error);
      throw error;
    }
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['/api/payments/schedules'] });
    toast({
      title: "Success",
      description: "Automatic payments have been cancelled.",
    });
    setShowPaymentSetup(true);
  },
  onError: (error: Error) => {
    console.error('[PaymentScheduleSection] Cancel payments mutation error:', error);
    toast({
      title: "Error",
      description: error.message || "Failed to cancel automatic payments. Please try again.",
      variant: "destructive",
    });
  },
});
```
