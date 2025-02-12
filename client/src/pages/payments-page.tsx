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
import type { Payment, Bowler, League } from "@shared/schema";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function PaymentsPage() {
  const [showForm, setShowForm] = useState(false);
  const [paymentToDelete, setPaymentToDelete] = useState<number | null>(null);
  const { toast } = useToast();

  // Query to get all leagues
  const { data: leaguesResponse } = useQuery<{ data: League[] }>({
    queryKey: ["/api/leagues"],
  });

  const { data: paymentsResponse, isLoading: loadingPayments } = useQuery<{ data: Payment[] }>({
    queryKey: ["/api/payments"],
    queryFn: async () => {
      try {
        const response = await fetch('/api/payments');
        if (!response.ok) {
          const error = await response.text();
          console.error('Failed to fetch payments:', error);
          throw new Error('Failed to fetch payments');
        }
        return response.json();
      } catch (error) {
        console.error('Error fetching payments:', error);
        throw error;
      }
    },
  });

  const { data: bowlersResponse, isLoading: loadingBowlers } = useQuery<{ data: Bowler[] }>({
    queryKey: ["/api/bowlers"],
    queryFn: async () => {
      try {
        const response = await fetch('/api/bowlers');
        if (!response.ok) {
          const error = await response.text();
          console.error('Failed to fetch bowlers:', error);
          throw new Error('Failed to fetch bowlers');
        }
        return response.json();
      } catch (error) {
        console.error('Error fetching bowlers:', error);
        throw error;
      }
    },
  });

  const deletePaymentMutation = useMutation({
    mutationFn: async (id: number) => {
      console.log('[Frontend] Deleting payment:', id);
      const response = await apiRequest("DELETE", `/api/payments/${id}`);
      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Frontend] Payment deletion failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        throw new Error(`Failed to delete payment: ${errorText}`);
      }
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      toast({
        title: "Success",
        description: "Payment has been deleted.",
      });
      setPaymentToDelete(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error deleting payment",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDelete = async (id: number) => {
    try {
      await deletePaymentMutation.mutateAsync(id);
    } catch (error) {
      console.error('[Frontend] Error in handleDelete:', error);
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
  const leagues = leaguesResponse?.data || [];
  const defaultLeagueId = leagues.length > 0 ? leagues[0].id : undefined;

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
                        {payment.type === 'cash' ? 'Cash' :
                          payment.type === 'check' ? `Check #${payment.checkNumber}` :
                            payment.type === 'credit_card' ? 'Credit Card' :
                              'Unknown'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setPaymentToDelete(payment.id)}
                        disabled={deletePaymentMutation.isPending}
                      >
                        {deletePaymentMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4 text-destructive" />
                        )}
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
        leagueId={defaultLeagueId}
      />

      <Dialog open={paymentToDelete !== null} onOpenChange={setOpen => setPaymentToDelete(setOpen ? paymentToDelete : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Payment</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this payment? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPaymentToDelete(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleDelete(paymentToDelete!)}
              disabled={deletePaymentMutation.isPending}
            >
              {deletePaymentMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}