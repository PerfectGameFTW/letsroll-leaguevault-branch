import { useEffect, useRef, useState } from "react";
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
import { Loader2 } from "lucide-react";
import { insertPaymentSchema, type InsertPayment, type Bowler } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { initializeSquare } from "@/lib/square";

interface PaymentFormProps {
  open: boolean;
  onClose: () => void;
  bowlers: Bowler[];
}

export function PaymentForm({ open, onClose, bowlers }: PaymentFormProps) {
  const { toast } = useToast();
  const cardContainer = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState<any>(null);
  const [isCardLoading, setIsCardLoading] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  const form = useForm<InsertPayment>({
    resolver: zodResolver(insertPaymentSchema),
    defaultValues: {
      amount: 2000, // $20.00
      weekOf: new Date(),
      status: "pending",
    },
  });

  useEffect(() => {
    let isMounted = true;
    let currentCard: any = null;

    async function initializeCard() {
      if (!open || !cardContainer.current || isCardLoading) {
        return;
      }

      setIsCardLoading(true);
      setInitError(null);

      try {
        const payments = await initializeSquare();
        if (!isMounted) return;

        if (payments) {
          const newCard = await payments.card();
          if (!isMounted) {
            await newCard.destroy();
            return;
          }

          const styles = {
            '.input-container': {
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '12px',
              backgroundColor: 'var(--background)',
            },
            '.input-container.is-focus': {
              borderColor: 'var(--primary)',
              boxShadow: '0 0 0 2px var(--primary)',
            },
            '.message-text': {
              color: 'var(--muted-foreground)',
              fontSize: '14px',
              marginTop: '4px',
            },
            input: {
              backgroundColor: 'transparent',
              color: 'var(--foreground)',
              fontFamily: 'var(--font-sans)',
              fontSize: '14px',
              padding: '0',
            },
          };

          await newCard.attach('#card-container', { styles });
          if (!isMounted) {
            await newCard.destroy();
            return;
          }

          currentCard = newCard;
          setCard(newCard);
        }
      } catch (error) {
        console.error('Square card initialization error:', error);
        if (isMounted) {
          const errorMessage = error instanceof Error ? error.message : "Failed to initialize payment form";
          setInitError(errorMessage);
          toast({
            title: "Error",
            description: errorMessage,
            variant: "destructive",
          });
        }
      } finally {
        if (isMounted) {
          setIsCardLoading(false);
        }
      }
    }

    initializeCard();

    return () => {
      isMounted = false;
      if (currentCard) {
        currentCard.destroy().catch(console.error);
      }
    };
  }, [open, toast]);

  const mutation = useMutation({
    mutationFn: async (data: InsertPayment) => {
      if (!card) {
        throw new Error("Payment form not initialized");
      }

      const result = await card.tokenize();
      if (result.status === 'OK') {
        const response = await fetch('/api/payments/process', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sourceId: result.token,
            amount: data.amount,
            locationId: import.meta.env.VITE_SQUARE_LOCATION_ID,
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(error || 'Payment processing failed');
        }

        const payment = await response.json();
        await apiRequest("POST", "/api/payments", {
          ...data,
          weekOf: data.weekOf.toISOString(),
          status: payment.status,
          squarePaymentId: payment.id,
          paidAt: new Date().toISOString(),
        });
      } else {
        throw new Error(result.errors[0].message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      toast({
        title: "Success",
        description: "Payment has been processed and recorded.",
      });
      handleClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Payment Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleClose = () => {
    if (card) {
      card.destroy().catch(console.error);
      setCard(null);
    }
    setInitError(null);
    form.reset();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Process Payment</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
            className="space-y-4"
          >
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

            <div className="space-y-2">
              <FormLabel>Card Details</FormLabel>
              <div 
                id="card-container"
                ref={cardContainer}
                className="border rounded-md bg-background"
                style={{
                  minHeight: '150px',
                  padding: '1px',
                  position: 'relative',
                }}
              >
                {isCardLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/50">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                )}
                {initError && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-sm text-destructive text-center px-4">
                      {initError}
                    </div>
                  </div>
                )}
              </div>
            </div>

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

            <div className="flex justify-end space-x-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={mutation.isPending || !card || isCardLoading}
                className="min-w-[120px]"
              >
                {mutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Pay Now'
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}