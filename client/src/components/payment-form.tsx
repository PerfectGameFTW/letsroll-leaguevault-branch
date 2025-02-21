import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSquarePayment } from "@/hooks/use-square-payment";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { InsertPayment, Bowler } from "@shared/schema";
import { insertPaymentSchema } from "@shared/schema";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface PaymentFormProps {
  open: boolean;
  onClose: () => void;
  bowlers: Bowler[];
  leagueId?: number;
}

export function PaymentForm({ open, onClose, bowlers, leagueId }: PaymentFormProps) {
  const { toast } = useToast();
  const cardContainerRef = useRef<HTMLDivElement>(null);
  const [isSquareReady, setIsSquareReady] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const initializationAttempted = useRef(false);
  const queryClient = useQueryClient();

  const form = useForm<InsertPayment>({
    resolver: zodResolver(insertPaymentSchema),
    defaultValues: {
      amount: 2000,
      weekOf: new Date(),
      status: "paid",
      type: "cash",
      leagueId: leagueId,
    },
  });

  const {
    card,
    isInitialized,
    error: squareError,
    initializeCard,
    cleanupCard,
  } = useSquarePayment({
    onError: (error) => {
      console.error('[PaymentForm] Square payment error:', error);
      form.setValue("type", "cash");
      toast({
        title: "Payment Form Notice",
        description: "Credit card form unavailable. Please try another payment method.",
        variant: "default",
      });
    },
  });

  useEffect(() => {
    if (leagueId) {
      form.setValue('leagueId', leagueId, { shouldDirty: false });
    }
  }, [leagueId]);

  const paymentType = form.watch("type");

  useEffect(() => {
    if (!open || paymentType !== "credit_card") {
      if (isInitialized) {
        cleanupCard();
        setIsSquareReady(false);
        initializationAttempted.current = false;
      }
      return;
    }

    if (!cardContainerRef.current || isInitialized || initializationAttempted.current) {
      return;
    }

    initializationAttempted.current = true;
    const container = cardContainerRef.current;

    initializeCard(container)
      .then(() => {
        console.log('[PaymentForm] Card form initialized successfully');
        setIsSquareReady(true);
      })
      .catch((error) => {
        console.error('[PaymentForm] Failed to initialize card form:', error);
        setIsSquareReady(false);
        form.setValue("type", "cash", { shouldDirty: false });
        toast({
          title: "Payment Form Notice",
          description: "Credit card form unavailable. Please try another payment method.",
          variant: "default",
        });
      });
  }, [open, paymentType]);

  useEffect(() => {
    if (!open) {
      form.reset();
    }
  }, [open]);

  const onSubmit = async (data: InsertPayment) => {
    try {
      setPaymentError(null);
      console.log('[PaymentForm] Submitting payment:', {
        ...data,
        amount: data.amount / 100,
      });

      if (data.type === 'credit_card') {
        if (!card) {
          throw new Error('Credit card form not initialized');
        }

        console.log('[PaymentForm] Tokenizing card...');
        const result = await card.tokenize();

        if (result.status !== 'OK' || !result.token) {
          const errors = result.errors || [];
          const errorMessage = errors.map((e: { message: string }) => e.message).join(', ') || 'Card validation failed';
          console.error('[PaymentForm] Card tokenization failed:', {
            errors,
            firstError: errorMessage
          });
          throw new Error(errorMessage);
        }

        console.log('[PaymentForm] Card tokenized successfully');
        data.squarePaymentId = result.token;
      }

      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      const responseData = await response.json();

      if (!response.ok) {
        console.error('[PaymentForm] Payment API error:', responseData);
        throw new Error(responseData.error?.message || 'Failed to process payment');
      }

      console.log('[PaymentForm] Payment processed successfully:', responseData);

      toast({
        title: "Success",
        description: "Payment recorded successfully",
      });

      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      onClose();
    } catch (error) {
      console.error('[PaymentForm] Payment submission error:', error);
      const errorMessage = error instanceof Error ? error.message : "Failed to process payment";
      setPaymentError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {paymentError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{paymentError}</AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="bowlerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bowler</FormLabel>
                  <FormControl>
                    <select
                      {...field}
                      className="w-full p-2 border rounded"
                      value={field.value || ""}
                      onChange={(e) => {
                        const value = e.target.value ? parseInt(e.target.value, 10) : undefined;
                        field.onChange(value);
                      }}
                    >
                      <option value="">Select a bowler</option>
                      {bowlers.map((bowler) => (
                        <option key={bowler.id} value={bowler.id}>
                          {bowler.name}
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  <FormMessage>
                    {form.formState.errors.bowlerId?.message ||
                     (!field.value && "Please select a bowler")}
                  </FormMessage>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount ($)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      {...field}
                      onChange={(e) => {
                        const dollars = parseFloat(e.target.value);
                        field.onChange(Math.round(dollars * 100));
                      }}
                      value={(field.value / 100).toFixed(2)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                      onChange={(e) => field.onChange(new Date(e.target.value))}
                    />
                  </FormControl>
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
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      value={field.value}
                      className="flex flex-col space-y-1"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="cash" id="cash" />
                        <label htmlFor="cash">Cash</label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="check" id="check" />
                        <label htmlFor="check">Check</label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="credit_card" id="credit_card" />
                        <label htmlFor="credit_card">Credit Card</label>
                      </div>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {paymentType === "check" && (
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

            {paymentType === "credit_card" && (
              <div>
                <div ref={cardContainerRef} className="mb-4" />
                {!isSquareReady && (
                  <p className="text-sm text-muted-foreground">
                    Loading credit card form...
                  </p>
                )}
              </div>
            )}

            <div className="flex justify-end space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  form.formState.isSubmitting || 
                  (paymentType === "credit_card" && !isSquareReady)
                }
              >
                {form.formState.isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  "Submit Payment"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}