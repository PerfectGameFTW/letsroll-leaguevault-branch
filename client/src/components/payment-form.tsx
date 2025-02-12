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
import { useEffect } from "react";

interface PaymentFormProps {
  open: boolean;
  onClose: () => void;
  bowlers: Bowler[];
  leagueId?: number;
}

export function PaymentForm({ open, onClose, bowlers, leagueId }: PaymentFormProps) {
  const { toast } = useToast();

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

  const mutation = useMutation({
    mutationFn: async (data: InsertPayment) => {
      console.log('Submitting payment:', data);

      // Handle credit card payment through Square
      if (data.type === 'credit_card') {
        try {
          const result = await createPayment(data.amount);
          if (result.status !== 'COMPLETED') {
            throw new Error('Payment processing failed');
          }
          data.squarePaymentId = result.id;
        } catch (error) {
          console.error('Square payment error:', error);
          throw new Error(error instanceof Error ? error.message : 'Payment processing failed');
        }
      }

      // Record the payment in our system
      try {
        const response = await apiRequest("POST", "/api/payments", {
          ...data,
          weekOf: data.weekOf.toISOString(),
        });

        if (!response.ok) {
          const error = await response.text();
          console.error('Payment API error:', error);
          throw new Error(error || 'Failed to record payment');
        }

        return response.json();
      } catch (error) {
        console.error('Payment submission error:', error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      toast({
        title: "Success",
        description: "Payment has been recorded.",
      });
      onClose();
      form.reset();
    },
    onError: (error: Error) => {
      console.error('Payment mutation error:', error);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: InsertPayment) => {
    console.log('Form submission:', data);
    if (!data.leagueId) {
      toast({
        title: "Error",
        description: "League ID is required",
        variant: "destructive",
      });
      return;
    }
    await mutation.mutateAsync(data);
  };

  useEffect(() => {
    if (form.watch("type") === "credit_card") {
      // Initialize Square payment form when credit card is selected
      const initSquare = async () => {
        try {
          await initializeSquare();
        } catch (error) {
          console.error('Failed to initialize Square:', error);
          toast({
            title: "Error",
            description: "Failed to initialize payment form. Please try again.",
            variant: "destructive",
          });
        }
      };
      initSquare();
    }
  }, [form.watch("type")]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
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
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Type</FormLabel>
                  <Select
                    onValueChange={field.onChange}
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

            {form.watch("type") === "credit_card" && (
              <div id="card-container" className="min-h-[100px] border rounded-md p-4" />
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
                <FormItem>
                  <FormLabel>League ID</FormLabel>
                  <FormControl>
                    <Input {...field} type="number"/>
                  </FormControl>
                  <FormMessage/>
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