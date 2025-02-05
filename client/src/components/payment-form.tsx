import { useEffect } from "react";
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
import { createPayment, initializeSquare } from "@/lib/square";

interface PaymentFormProps {
  open: boolean;
  onClose: () => void;
  bowlers: Bowler[];
}

export function PaymentForm({ open, onClose, bowlers }: PaymentFormProps) {
  const { toast } = useToast();
  const form = useForm<InsertPayment>({
    resolver: zodResolver(insertPaymentSchema),
    defaultValues: {
      amount: 2000, // $20.00
      weekOf: new Date(),
      status: "pending",
    },
  });

  // Initialize Square card form when dialog opens
  useEffect(() => {
    let card: any = null;

    async function setupCard() {
      try {
        const payments = await initializeSquare();
        card = await payments.card();
        await card.attach('#card-container');
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to initialize payment form";
        toast({
          title: "Payment Form Error",
          description: message,
          variant: "destructive",
        });
      }
    }

    if (open) {
      setupCard();
    }

    // Cleanup function
    return () => {
      if (card) {
        card.destroy();
      }
    };
  }, [open, toast]);

  const mutation = useMutation({
    mutationFn: async (data: InsertPayment) => {
      try {
        // Process payment through Square
        const squarePayment = await createPayment(data.amount);

        // Create payment record
        await apiRequest("POST", "/api/payments", {
          ...data,
          weekOf: data.weekOf.toISOString(),
          status: squarePayment.status,
          squarePaymentId: squarePayment.id,
          paidAt: new Date().toISOString(),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Payment processing failed";
        throw new Error(message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      toast({
        title: "Payment Successful",
        description: "The payment has been processed and recorded.",
      });
      onClose();
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Payment Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
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
                className="p-3 border rounded-md min-h-[40px]"
              />
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