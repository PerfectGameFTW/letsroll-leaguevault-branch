import { useState } from "react";
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
import { Loader2, Plus } from "lucide-react";
import type { Payment, Bowler } from "@shared/schema";
import { format } from "date-fns";

export default function PaymentsPage() {
  const [showForm, setShowForm] = useState(false);

  const { data: paymentsResponse, isLoading: loadingPayments } = useQuery<{ data: Payment[] }>({
    queryKey: ["/api/payments"],
  });

  const { data: bowlersResponse, isLoading: loadingBowlers } = useQuery<{ data: Bowler[] }>({
    queryKey: ["/api/bowlers"],
  });

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
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center">
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