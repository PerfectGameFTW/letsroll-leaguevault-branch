import { FC } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { differenceInWeeks, format } from "date-fns";
import { formatCurrency } from "@/lib/utils";
import type { Payment, League } from "@shared/schema";

interface BowlerPaymentTableProps {
  payments: Payment[];
  league: League;
}

export const BowlerPaymentTable: FC<BowlerPaymentTableProps> = ({ payments, league }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment History</CardTitle>
        <CardDescription>Record of all your payments</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Week</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-4">
                  No payments recorded
                </TableCell>
              </TableRow>
            ) : (
              payments.map((payment) => {
                const weekNumber = league.seasonStart
                  ? Math.max(1, differenceInWeeks(new Date(payment.weekOf), new Date(league.seasonStart)) + 1)
                  : '-';

                return (
                  <TableRow key={payment.id}>
                    <TableCell>
                      {format(new Date(payment.weekOf), 'MM/dd/yy')}
                    </TableCell>
                    <TableCell>
                      Week {weekNumber}
                    </TableCell>
                    <TableCell>
                      {formatCurrency(payment.amount)}
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
                      <Badge
                        variant={payment.status === 'refunded' ? 'destructive' : 'outline'}
                        className={
                          payment.status === 'paid' ? 'border-green-500 text-green-700 bg-green-50' :
                          payment.status === 'failed' ? 'border-yellow-500 text-yellow-700 bg-yellow-50' :
                          payment.status === 'pending' ? 'border-blue-500 text-blue-700 bg-blue-50' :
                          ''
                        }
                      >
                        {payment.status === 'paid' ? 'Paid' :
                          payment.status === 'refunded' ? 'Refunded' :
                          payment.status === 'failed' ? 'Failed' :
                          payment.status === 'pending' ? 'Pending' :
                          payment.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};
