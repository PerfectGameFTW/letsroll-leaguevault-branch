import { useState, useMemo, useCallback } from "react";
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
import { Loader2, Plus, Search, Trash2, RotateCcw, ChevronLeft, ChevronRight } from "lucide-react";
import type { Payment, Bowler, League, PaginationMeta } from "@shared/schema";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PAGE_SIZE_OPTIONS = [25, 50, 100];
const DEFAULT_PAGE_SIZE = 50;

interface PaginatedPaymentsResponse {
  success: boolean;
  data: Payment[];
  pagination: PaginationMeta;
}

export default function PaymentsPage() {
  const [showForm, setShowForm] = useState(false);
  const [paymentToDelete, setPaymentToDelete] = useState<number | null>(null);
  const [paymentToRefund, setPaymentToRefund] = useState<Payment | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const { toast } = useToast();

  const { data: leaguesResponse } = useQuery<{ data: League[] }>({
    queryKey: ["/api/leagues"],
    staleTime: 1000 * 60 * 30,
  });

  const { data: paymentsResponse, isLoading: loadingPayments } = useQuery<PaginatedPaymentsResponse>({
    queryKey: ["/api/payments", "paginated", page, pageSize],
    queryFn: async () => {
      const res = await fetch(`/api/payments?page=${page}&limit=${pageSize}`, {
        credentials: "include",
        headers: { "Accept": "application/json" },
      });
      if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
      return res.json();
    },
    staleTime: 1000 * 60,
  });

  const { data: bowlersResponse, isLoading: loadingBowlers } = useQuery<{ data: Bowler[] }>({
    queryKey: ["/api/bowlers"],
    enabled: !!paymentsResponse?.data?.length,
    staleTime: 1000 * 60 * 5,
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
  const pagination = paymentsResponse?.pagination;
  const bowlers = bowlersResponse?.data || [];
  const leagues = leaguesResponse?.data || [];
  const defaultLeagueId = leagues.length > 0 ? leagues[0].id : undefined;

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

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handlePageSizeChange = useCallback((newSize: string) => {
    setPageSize(parseInt(newSize));
    setPage(1);
  }, []);

  if ((loadingPayments || loadingBowlers) && !payments.length) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  const startItem = pagination ? (pagination.page - 1) * pagination.limit + 1 : 0;
  const endItem = pagination ? Math.min(pagination.page * pagination.limit, pagination.total) : payments.length;

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
                          className={payment.status === "refunded" ? "border-destructive text-destructive" : ""}
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
                          {payment.status === "paid" && payment.type === "credit_card" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              title="Refund payment"
                              onClick={() => setPaymentToRefund(payment)}
                              disabled={refundPaymentMutation.isPending}
                            >
                              <RotateCcw className="h-4 w-4 text-destructive" />
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

        {pagination && pagination.totalPages > 0 && (
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>
                Showing {startItem}–{endItem} of {pagination.total} payments
              </span>
              <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                <SelectTrigger className="h-8 w-[70px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span>per page</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              {generatePageNumbers(page, pagination.totalPages).map((p, i) =>
                p === '...' ? (
                  <span key={`ellipsis-${i}`} className="px-2 text-muted-foreground">...</span>
                ) : (
                  <Button
                    key={p}
                    variant={p === page ? "default" : "outline"}
                    size="sm"
                    className="min-w-[36px]"
                    onClick={() => handlePageChange(p as number)}
                  >
                    {p}
                  </Button>
                )
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= pagination.totalPages}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

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
                variant="destructive"
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

function generatePageNumbers(current: number, total: number): (number | string)[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | string)[] = [1];

  if (current > 3) {
    pages.push('...');
  }

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (current < total - 2) {
    pages.push('...');
  }

  if (total > 1) {
    pages.push(total);
  }

  return pages;
}
