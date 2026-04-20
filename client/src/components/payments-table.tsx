import { Loader2, Trash2, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { isCardPaymentType } from "@shared/schema/constants";
import type { Payment, Bowler } from "@shared/schema";

function paymentTypeLabel(payment: Payment): string {
  switch (payment.type) {
    case "cash": return "Cash";
    case "check": return `Check #${payment.checkNumber}`;
    case "credit_card": return "Credit Card";
    case "square": return "Square";
    case "cardpointe": return "CardPointe";
    default: return "Other Payment";
  }
}

interface Props {
  payments: Payment[];
  filteredPayments: Payment[];
  bowlers: Bowler[];
  isAdmin: boolean;
  onRefund: (payment: Payment) => void;
  onDelete: (id: number) => void;
  isRefundPending: boolean;
  isDeletePending: boolean;
}

export function PaymentsTable({
  payments,
  filteredPayments,
  bowlers,
  isAdmin,
  onRefund,
  onDelete,
  isRefundPending,
  isDeletePending,
}: Props) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Bowler</TableHead>
            <TableHead>Week Of</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Payment Type</TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center">No payments found</TableCell>
            </TableRow>
          ) : filteredPayments.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center">No payments match your search</TableCell>
            </TableRow>
          ) : (
            filteredPayments.map((payment) => {
              const bowler = bowlers.find((b) => b.id === payment.bowlerId);
              return (
                <TableRow key={payment.id}>
                  <TableCell>{bowler?.name || "Unknown Bowler"}</TableCell>
                  <TableCell>{format(new Date(payment.weekOf), "MMM d, yyyy")}</TableCell>
                  <TableCell>${(payment.amount / 100).toFixed(2)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        payment.status === "paid" ? "default" :
                        payment.status === "pending" ? "secondary" :
                        payment.status === "failed" ? "destructive" :
                        "outline"
                      }
                      className={payment.status === "refunded" ? "border-destructive text-destructive" : ""}
                    >
                      {payment.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge variant="outline">{paymentTypeLabel(payment)}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {payment.status === "paid" && isCardPaymentType(payment.type) && isAdmin && (
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Refund payment"
                          onClick={() => onRefund(payment)}
                          disabled={isRefundPending}
                        >
                          <RotateCcw className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                      {(!isCardPaymentType(payment.type) || isAdmin) && (
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Delete payment"
                          onClick={() => onDelete(payment.id)}
                          disabled={isDeletePending}
                        >
                          {isDeletePending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4 text-destructive" />
                          )}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
