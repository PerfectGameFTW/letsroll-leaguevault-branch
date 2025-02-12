import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, AlertCircle } from "lucide-react";
import { insertPaymentSchema, type InsertPayment, type Bowler } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { createPayment, cleanupCard } from "@/lib/square";
import { useSquarePayment } from "@/hooks/use-square-payment";

interface PaymentFormProps {
  open: boolean;
  onClose: () => void;
  bowlers: Bowler[];
  leagueId?: number;
}

export function PaymentForm({ open, onClose, bowlers, leagueId }: PaymentFormProps) {
  const { toast } = useToast();
  const cardContainerRef = useRef<HTMLDivElement>(null);

  const {
    card,
    isInitialized,
    error: squareError,
    initializeCard,
    cleanupCard,
  } = useSquarePayment({
    onError: (error) => {
      // Switch to cash payment on error
      form.setValue("type", "cash");
    },
  });

  const form = useForm<InsertPayment>({
    resolver: zodResolver(insertPaymentSchema),
    defaultValues: {
      amount: 2000, // $20.00
      weekOf: new Date(),
      status: "paid",
      type: "cash",
      leagueId: leagueId,
    },
  });

  // Update leagueId when it changes
  useEffect(() => {
    if (leagueId) {
      form.setValue('leagueId', leagueId);
    }
  }, [leagueId, form]);

  // Handle Square initialization when credit card is selected
  useEffect(() => {
    const paymentType = form.watch("type");

    if (paymentType === "credit_card" && open && cardContainerRef.current) {
      initializeCard(cardContainerRef.current);
    }

    // Cleanup when payment type changes or dialog closes
    return () => {
      if (paymentType !== "credit_card" || !open) {
        cleanupCard();
      }
    };
  }, [form.watch("type"), open, initializeCard, cleanupCard]);

  // Cleanup on dialog close
  useEffect(() => {
    if (!open) {
      cleanupCard();
      form.reset();
    }
  }, [open, cleanupCard, form]);

  const mutation = useMutation({
    mutationFn: async (data: InsertPayment) => {
      console.log('[PaymentForm] Payment mutation started:', data);

      // Handle credit card payment through Square
      if (data.type === 'credit_card') {
        if (!card) {
          throw new Error('Credit card form not initialized');
        }

        try {
          console.log('[PaymentForm] Processing credit card payment...');
          const result = await createPayment(data.amount, card);
          console.log('[PaymentForm] Square payment result:', result);
          if (result.status !== 'COMPLETED') {
            throw new Error('Payment processing failed');
          }
          data.squarePaymentId = result.id;
        } catch (error) {
          console.error('[PaymentForm] Square payment error:', error);
          throw new Error(error instanceof Error ? error.message : 'Payment processing failed');
        }
      }

      // Record the payment in our system
      try {
        console.log('[PaymentForm] Sending payment to API:', {
          ...data,
          weekOf: data.weekOf.toISOString(),
        });

        const response = await apiRequest("POST", "/api/payments", {
          ...data,
          weekOf: data.weekOf.toISOString(),
        });

        if (!response.ok) {
          const error = await response.text();
          console.error('[PaymentForm] Payment API error:', error);
          throw new Error(error || 'Failed to record payment');
        }

        const result = await response.json();
        console.log('[PaymentForm] Payment API response:', result);
        return result;
      } catch (error) {
        console.error('[PaymentForm] Payment submission error:', error);
        throw error;
      }
    },
    onSuccess: () => {
      console.log('[PaymentForm] Payment mutation succeeded');
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      toast({
        title: "Success",
        description: "Payment has been recorded.",
      });
      onClose();
      form.reset();
    },
    onError: (error: Error) => {
      console.error('[PaymentForm] Payment mutation error:', error);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(open) => {
      if (!open) {
        onClose();
      }
    }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
            <FormField
              control={form.control}
              name="bowlerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bowler</FormLabel>
                  <Select
                    onValueChange={(value) => field.onChange(parseInt(value))}
                    defaultValue={field.value?.toString()}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a bowler" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {bowlers.map((bowler) => (
                        <SelectItem
                          key={bowler.id}
                          value={bowler.id.toString()}
                        >
                          {bowler.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Type</FormLabel>
                  <Select
                    onValueChange={(value) => {
                      field.onChange(value);
                      if (value !== 'credit_card') {
                        cleanupCard();
                      }
                    }}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select payment type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="check">Check</SelectItem>
                      <SelectItem value="credit_card">Credit Card</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      {...field}
                      value={field.value / 100}
                      onChange={(e) =>
                        field.onChange(Math.round(parseFloat(e.target.value) * 100))
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {form.watch("type") === "credit_card" && open && (
              <>
                <div
                  id="card-container"
                  ref={cardContainerRef}
                  className={`min-h-[100px] border rounded-md p-4 mt-4 ${
                    squareError ? 'border-destructive' : ''
                  }`}
                />
                {squareError && (
                  <div className="flex items-center gap-2 text-sm text-destructive mt-2">
                    <AlertCircle className="h-4 w-4" />
                    <span>{squareError}</span>
                  </div>
                )}
              </>
            )}

            {form.watch("type") === "check" && (
              <FormField
                control={form.control}
                name="checkNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Check Number</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="weekOf"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Week Of</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      {...field}
                      value={field.value instanceof Date ? field.value.toISOString().split('T')[0] : ''}
                      onChange={(e) =>
                        field.onChange(new Date(e.target.value))
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="leagueId"
              render={({ field }) => (
                <FormItem className="hidden">
                  <FormControl>
                    <Input {...field} type="number"/>
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex justify-end space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={mutation.isPending}
                className="min-w-[120px]"
              >
                {mutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Record Payment'
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}