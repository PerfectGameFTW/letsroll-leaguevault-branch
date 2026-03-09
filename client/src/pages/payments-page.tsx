import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Search, Trash2, RotateCcw } from "lucide-react";
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
import { useMutation } from "@tanstack/react-query";

export default function PaymentsPage() {
  const [showForm, setShowForm] = useState(false);
  const [paymentToDelete, setPaymentToDelete] = useState<number | null>(null);
  const [paymentToRefund, setPaymentToRefund] = useState<Payment | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const { toast } = useToast();


  // Query to get all leagues
  const { data: leaguesResponse } = useQuery<{ data: League[] }>({
    queryKey: ["/api/leagues"],
    staleTime: 1000 * 60 * 30, // 30 minutes
  });

  const { data: paymentsResponse, isLoading: loadingPayments } = useQuery<{ data: Payment[] }>({
    queryKey: ["/api/payments"],
    staleTime: 1000 * 60, // 1 minute
  });

  // Only fetch bowlers if we have payments
  const { data: bowlersResponse, isLoading: loadingBowlers } = useQuery<{ data: Bowler[] }>({
    queryKey: ["/api/bowlers"],
    enabled: !!paymentsResponse?.data?.length,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const deletePaymentMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest(`/api/payments/${id}`, "DELETE");
      if (!response.success) {
        throw new Error(`Failed to delete payment: ${response.error?.message || "Unknown error"}`);
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

  const refundPaymentMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason?: string }) => {
      const response = await apiRequest(`/api/payments/${id}/refund`, "POST", { reason });
      if (!response.success) {
        throw new Error(response.error?.message || "Failed to process refund");
      }
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      toast({
        title: "Refund Processed",
        description: "The payment has been successfully refunded.",
      });
      setPaymentToRefund(null);
      setRefundReason("");
    },
    onError: (error: Error) => {
      toast({
        title: "Refund Failed",
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

  const payments = paymentsResponse?.data || [];
  const bowlers = bowlersResponse?.data || [];
  const leagues = leaguesResponse?.data || [];
  const defaultLeagueId = leagues.length > 0 ? leagues[0].id : undefined;

  // Filter payments based on bowler name search
  const filteredPayments = useMemo(() => {
    if (!searchQuery.trim()) {
      return payments;
    }
    
    const searchLower = searchQuery.toLowerCase();
    return payments.filter((payment) => {
      const bowler = bowlers.find((b) => b.id === payment.bowlerId);
      return bowler?.name?.toLowerCase().includes(searchLower);
    });
  }, [payments, bowlers, searchQuery]);

  // Show loading state only when initial data is loading
  if ((loadingPayments || loadingBowlers) && !payments.length) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">Payments</h1>
          <Button onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Record Payment
          </Button>
        </div>

        <div className="flex items-center space-x-2 mb-6">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search by bowler name..."
              className="pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {searchQuery && (
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => setSearchQuery("")}
            >
              Clear
            </Button>
          )}
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
              ) : filteredPayments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center">
                    No payments match your search
                  </TableCell>
                </TableRow>
              ) : (
                filteredPayments.map((payment) => {
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
                          variant={
                            payment.status === "paid" ? "default" :
                              payment.status === "pending" ? "secondary" :
                                payment.status === "failed" ? "destructive" :
                                  payment.status === "refunded" ? "outline" :
                                    "outline"
                          }
                          className={payment.status === "refunded" ? "border-orange-500 text-orange-600" : ""}
                        >
                          {payment.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {payment.type === 'cash' ? 'Cash' :
                            payment.type === 'check' ? `Check #${payment.checkNumber}` :
                              payment.type === 'credit_card' ? 'Credit Card' :
                                'Other Payment'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {payment.status === "paid" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Refund payment"
                              onClick={() => setPaymentToRefund(payment)}
                              disabled={refundPaymentMutation.isPending}
                            >
                              <RotateCcw className="h-4 w-4 text-orange-500" />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Delete payment"
                            onClick={() => setPaymentToDelete(payment.id)}
                            disabled={deletePaymentMutation.isPending}
                          >
                            {deletePaymentMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4 text-destructive" />
                            )}
                          </Button>
                        </div>
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

        <Dialog open={paymentToRefund !== null} onOpenChange={(open) => { if (!open) { setPaymentToRefund(null); setRefundReason(""); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Refund Payment</DialogTitle>
              <DialogDescription>
                {paymentToRefund && (
                  <>
                    Refund <strong>${(paymentToRefund.amount / 100).toFixed(2)}</strong> ({paymentToRefund.type === 'credit_card' ? 'Credit Card' : paymentToRefund.type === 'check' ? 'Check' : 'Cash'})?
                    {paymentToRefund.type === 'credit_card' && ' The refund will be processed through Square.'}
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="py-2">
              <label className="text-sm font-medium">Reason (optional)</label>
              <Input
                placeholder="Enter refund reason..."
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                className="mt-1"
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => { setPaymentToRefund(null); setRefundReason(""); }}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                className="bg-orange-500 hover:bg-orange-600"
                onClick={() => {
                  if (paymentToRefund) {
                    refundPaymentMutation.mutate({ id: paymentToRefund.id, reason: refundReason || undefined });
                  }
                }}
                disabled={refundPaymentMutation.isPending}
              >
                {refundPaymentMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <RotateCcw className="h-4 w-4 mr-2" />
                )}
                Process Refund
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}