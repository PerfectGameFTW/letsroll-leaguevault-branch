import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import type { League, Payment } from "@shared/schema";
import { BowlerLayout } from "@/components/bowler-layout";
import { Loader2, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { differenceInWeeks, startOfToday, isValid, parseISO, format } from "date-fns";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    message: string;
    code?: string;
  };
}

export default function PaymentHistoryPage() {
  // Get current user and their bowler ID
  const { data: currentUser } = useQuery<ApiResponse<{ bowlerId: number }>>({
    queryKey: ["/api/user"],
  });

  const bowlerId = currentUser?.data?.bowlerId;

  // Get bowler details
  const { data: bowlerResponse } = useQuery<ApiResponse<{ name: string }>>({
    queryKey: [`/api/bowlers/${bowlerId}`],
    enabled: !!bowlerId,
  });

  // Get league information for the bowler
  const { data: bowlerLeaguesResponse } = useQuery<ApiResponse<{ leagueId: number }[]>>({
    queryKey: ["/api/bowler-leagues", bowlerId],
    enabled: !!bowlerId,
  });

  const leagueId = bowlerLeaguesResponse?.data?.[0]?.leagueId;

  // Get league details
  const { data: leagueResponse, isLoading: loadingLeague } = useQuery<ApiResponse<League>>({
    queryKey: [`/api/leagues/${leagueId}`],
    enabled: !!leagueId,
  });

  // Get payment history
  const { data: paymentsResponse, isLoading: loadingPayments } = useQuery<ApiResponse<Payment[]>>({
    queryKey: ["/api/payments", bowlerId, leagueId],
    enabled: !!bowlerId && !!leagueId,
  });

  const league = leagueResponse?.data;
  const payments = paymentsResponse?.data || [];
  const bowlerName = bowlerResponse?.data?.name;

  // Calculate payment statistics
  const totalPaidPayments = payments.filter(p => p.status === 'paid');
  const totalPaidAmount = totalPaidPayments.reduce((sum, p) => sum + p.amount, 0);

  let weeksDue = 0;
  let totalSeasonDues = 0;
  let amountPastDue = 0;

  if (league?.seasonStart && league.seasonEnd && league.weeklyFee) {
    const seasonStart = parseISO(league.seasonStart);
    const seasonEnd = parseISO(league.seasonEnd);
    const today = startOfToday();

    if (isValid(seasonStart) && isValid(seasonEnd) && isValid(today)) {
      if (today < seasonStart) {
        weeksDue = 0;
      } else if (today > seasonEnd) {
        weeksDue = Math.max(0, differenceInWeeks(seasonEnd, seasonStart));
      } else {
        weeksDue = Math.max(0, differenceInWeeks(today, seasonStart));
      }

      totalSeasonDues = league.weeklyFee * weeksDue;
      amountPastDue = Math.max(0, totalSeasonDues - totalPaidAmount);
    }
  }

  if (loadingLeague || loadingPayments) {
    return (
      <BowlerLayout bowlerName={bowlerName} leagueName={league?.name}>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </BowlerLayout>
    );
  }

  if (!league) {
    return (
      <BowlerLayout bowlerName={bowlerName}>
        <div className="text-center">League not found</div>
      </BowlerLayout>
    );
  }

  return (
    <BowlerLayout bowlerName={bowlerName} leagueName={league.name}>
      <div className="space-y-6">
        <Link
          href="/bowler-dashboard"
          className="text-muted-foreground hover:text-foreground flex items-center mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Link>

        <div>
          <h1 className="text-2xl font-bold mb-2">Payment History</h1>
          <p className="text-muted-foreground mb-6">
            Track your payments and balance for {league.name}
          </p>
        </div>

        {/* Payment Summary Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Total Amount Due</CardTitle>
              <CardDescription>
                {weeksDue} week{weeksDue === 1 ? "" : "s"} at ${(league.weeklyFee / 100).toFixed(2)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">${(totalSeasonDues / 100).toFixed(2)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Amount Paid</CardTitle>
              <CardDescription>Total payments received</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">${(totalPaidAmount / 100).toFixed(2)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Past Due Amount</CardTitle>
              <CardDescription>Outstanding balance</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-destructive">
                ${(amountPastDue / 100).toFixed(2)}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Payment History Table */}
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
                    const weekNumber = league?.seasonStart
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
                          ${(payment.amount / 100).toFixed(2)}
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
                          <Badge variant={payment.status === 'paid' ? 'success' : 'default'}>
                            {payment.status}
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
      </div>
    </BowlerLayout>
  );
}