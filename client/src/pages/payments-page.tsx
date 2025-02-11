import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout";
import { PaymentForm } from "@/components/payment-form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2 } from "lucide-react";
import type { Payment, Bowler } from "@shared/schema";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function PaymentsPage() {
  const [showForm, setShowForm] = useState(false);
  const [paymentToDelete, setPaymentToDelete] = useState<number | null>(null);
  const { toast } = useToast();

  const { data: paymentsResponse, isLoading: loadingPayments } = useQuery<{ data: Payment[] }>({
    queryKey: ["/api/payments"],
    queryFn: async () => {
      const response = await fetch('/api/payments');
      if (!response.ok) {
        throw new Error('Failed to fetch payments');
      }
      return response.json();
    },
  });

  const { data: bowlersResponse, isLoading: loadingBowlers } = useQuery<{ data: Bowler[] }>({
    queryKey: ["/api/bowlers"],
    queryFn: async () => {
      const response = await fetch('/api/bowlers');
      if (!response.ok) {
        throw new Error('Failed to fetch bowlers');
      }
      return response.json();
    },
  });

  const deletePaymentMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("DELETE", `/api/payments/${id}`);
      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }
    },
    onMutate: async (deletedId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ 
        queryKey: ["/api/payments"] 
      });

      // Get the current payments
      const previousPayments = queryClient.getQueryData(["/api/payments"]);

      // Optimistically update the cache
      if (previousPayments?.data) {
        const updatedData = {
          data: previousPayments.data.filter((payment: Payment) => payment.id !== deletedId)
        };

        // Update the main payments list
        queryClient.setQueryData(["/api/payments"], updatedData);

        // Also update any filtered views that might exist
        queryClient.setQueriesData(
          { queryKey: ["/api/payments"] },
          (oldData: any) => {
            if (oldData?.data) {
              return {
                data: oldData.data.filter((payment: Payment) => payment.id !== deletedId)
              };
            }
            return oldData;
          }
        );
      }

      return { previousPayments };
    },
    onError: (error: Error, _, context) => {
      // Restore the previous data on error
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
      // Force refetch all payment queries to ensure consistency
      queryClient.invalidateQueries({
        queryKey: ["/api/payments"],
        refetchType: "all"
      });

      toast({
        title: "Payment deleted",
        description: "The payment has been successfully deleted.",
      });
    },
  });

  const handleDelete = async (id: number) => {
    try {
      await deletePaymentMutation.mutateAsync(id);
    } catch (error) {
      console.error('Error in handleDelete:', error);
    }
  };

  if (loadingPayments || loadingBowlers) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  const payments = paymentsResponse?.data || [];
  const bowlers = bowlersResponse?.data || [];

  return (
    <Layout>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Payments</h1>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Record Payment
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bowler</TableHead>
              <TableHead>Week Of</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Payment Type</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center">
                  No payments found
                </TableCell>
              </TableRow>
            ) : (
              payments.map((payment) => {
                const bowler = bowlers.find((b) => b.id === payment.bowlerId);
                return (
                  <TableRow key={payment.id}>
                    <TableCell>{bowler?.name || 'Unknown Bowler'}</TableCell>
                    <TableCell>
                      {format(new Date(payment.weekOf), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>${(payment.amount / 100).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={payment.status === "paid" ? "default" : "secondary"}
                      >
                        {payment.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {payment.squarePaymentId === 'cash' ? 'Cash' :
                         payment.squarePaymentId === 'check' ? 'Check' :
                         payment.squarePaymentId === 'square' ? 'Square' : 'Other'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDelete(payment.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <PaymentForm
        open={showForm}
        onClose={() => setShowForm(false)}
        bowlers={bowlers}
      />
    </Layout>
  );
}