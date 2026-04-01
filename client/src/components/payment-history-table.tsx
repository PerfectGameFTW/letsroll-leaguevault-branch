import { memo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Payment } from "@shared/schema";

interface BowlerInfo {
  id: number;
  name: string;
}

interface PaymentHistoryTableProps {
  payments: Payment[];
  bowlers: BowlerInfo[];
  bowlerTeamMap?: Map<number, string>;
  onStartEdit: (payment: Payment) => void;
  onDelete: (paymentId: number) => void;
  isDeletePending: boolean;
  isAdmin?: boolean;
}

export const PaymentHistoryTable = memo(function PaymentHistoryTable({
  payments,
  bowlers,
  bowlerTeamMap,
  onStartEdit,
  onDelete,
  isDeletePending,
  isAdmin = false,
}: PaymentHistoryTableProps) {
  const showTeamColumn = !!bowlerTeamMap;

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Bowler</TableHead>
            {showTeamColumn && <TableHead>Team</TableHead>}
            <TableHead>Payment Type</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments?.length === 0 ? (
            <TableRow>
              <TableCell colSpan={showTeamColumn ? 5 : 4} className="text-center">
                No payment history
              </TableCell>
            </TableRow>
          ) : (
            payments?.map((payment) => {
              const bowler = bowlers.find(b => b.id === payment.bowlerId);
              const teamName = bowlerTeamMap?.get(payment.bowlerId);

              return (
                <TableRow key={payment.id}>
                  <TableCell>{bowler?.name || 'Unknown Bowler'}</TableCell>
                  {showTeamColumn && (
                    <TableCell className="text-muted-foreground">{teamName || '—'}</TableCell>
                  )}
                  <TableCell>
                    <Badge variant="outline">
                      {payment.type === 'cash' ? 'Cash' :
                        payment.type === 'check' ? `Check #${payment.checkNumber}` :
                        payment.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    ${(payment.amount / 100).toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => onStartEdit(payment)}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4 text-primary">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                      </svg>
                    </Button>
                    {(payment.type !== 'credit_card' || isAdmin) && (
                      <Button
                        size="icon"
                        variant="ghost"
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
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
});
