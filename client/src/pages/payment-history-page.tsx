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
import { differenceInWeeks, startOfToday, format } from "date-fns";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    message: string;
    code?: string;
  };
}

interface User {
  id: number;
  bowlerId: number | null;
  name: string | null;
  email: string;
  isAdmin: boolean;
  isOrganizationAdmin: boolean;
}

export default function PaymentHistoryPage() {
  // Get current user and their bowler ID
  const { data: currentUser, isLoading: loadingUser, error: userError } = useQuery<ApiResponse<User>>({
    queryKey: ["/api/user"],
  });

  const bowlerId = currentUser?.data?.bowlerId;

  // Get bowler details
  const { data: bowlerResponse, isLoading: loadingBowler, error: bowlerError } = useQuery<ApiResponse<{ name: string }>>({
    queryKey: [`/api/bowlers/${bowlerId}`],
    enabled: !!bowlerId,
  });

  // Get league information for the bowler
  const { data: bowlerLeaguesResponse, isLoading: loadingBowlerLeagues, error: bowlerLeaguesError } = useQuery<ApiResponse<{ leagueId: number }[]>>({
    queryKey: ["/api/bowler-leagues", bowlerId],
    enabled: !!bowlerId,
  });

  // Find the first active league for the bowler
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
  const bowlerName = bowlerResponse?.data?.name || '';

  // Calculate payment statistics
  const totalPaidPayments = payments.filter(p => p.status === 'paid');
  const totalPaidAmount = totalPaidPayments.reduce((sum, p) => sum + p.amount, 0);

  let weeksDue = 0;
  let totalSeasonDues = 0;
  let totalWeeksInSeason = 0;
  let fullSeasonAmount = 0;
  let amountPastDue = 0;
  let remainingBalance = 0;

  if (league?.seasonStart && league.seasonEnd && league.weeklyFee) {
    const seasonStart = new Date(league.seasonStart);
    const seasonEnd = new Date(league.seasonEnd);
    const today = startOfToday();

    if (today < seasonStart) {
      weeksDue = 0;
    } else if (today > seasonEnd) {
      weeksDue = Math.max(0, differenceInWeeks(seasonEnd, seasonStart));
    } else {
      weeksDue = Math.max(0, differenceInWeeks(today, seasonStart));
    }

    totalSeasonDues = league.weeklyFee * weeksDue;
    totalWeeksInSeason = differenceInWeeks(seasonEnd, seasonStart);
    fullSeasonAmount = league.weeklyFee * totalWeeksInSeason;
    amountPastDue = Math.max(0, totalSeasonDues - totalPaidAmount);
    remainingBalance = fullSeasonAmount - totalPaidAmount;
  }

  if (loadingUser || loadingBowler || loadingBowlerLeagues || loadingLeague || loadingPayments) {
    return (
      <BowlerLayout bowlerName={bowlerName || 'Loading...'} leagueName={league?.name || 'Loading...'}>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </BowlerLayout>
    );
  }

  // Show error if user is not authenticated
  if (userError) {
    return (
      <BowlerLayout bowlerName="Authentication Error" leagueName="Error">
        <div className="text-center space-y-4">
          <p className="text-destructive">Please log in to view payment history</p>
          <Link href="/login" className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-white">
            Log In
          </Link>
        </div>
      </BowlerLayout>
    );
  }
  
  // Show message if user has no associated bowler
  if (currentUser?.data && !currentUser.data.bowlerId) {
    return (
      <BowlerLayout bowlerName={currentUser.data.name || "Administrator"} leagueName="No Bowler Account">
        <div className="text-center space-y-4">
          <p>You don't have a bowler account linked to your user profile.</p>
          {currentUser.data.isAdmin && (
            <div className="p-4 border rounded-md bg-amber-50 max-w-md mx-auto">
              <p className="text-amber-800">As an administrator, you can view payment history by selecting a specific bowler.</p>
            </div>
          )}
          <Link href="/" className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-white">
            Return to Dashboard
          </Link>
        </div>
      </BowlerLayout>
    );
  }

  // Show error if bowler is not found
  if (bowlerId && bowlerError) {
    return (
      <BowlerLayout bowlerName="Error" leagueName="Error">
        <div className="text-center text-destructive">
          Failed to load bowler information
        </div>
      </BowlerLayout>
    );
  }

  // Show error if bowler has no associated leagues
  if (!bowlerLeaguesResponse?.data?.length) {
    return (
      <BowlerLayout bowlerName={bowlerName || 'Bowler'} leagueName="No League">
        <div className="text-center space-y-4">
          <p>You are not registered in any leagues</p>
          <Link href="/bowler-dashboard" className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-white">
            Return to Dashboard
          </Link>
        </div>
      </BowlerLayout>
    );
  }

  if (!league) {
    return (
      <BowlerLayout bowlerName={bowlerName} leagueName="League not found">
        <div className="text-center space-y-4">
          <p>League information cannot be loaded for this bowler</p>
          <div className="text-left border p-4 rounded-md bg-muted/30">
            <p className="font-mono text-sm">BowlerId: {bowlerId}</p>
            <p className="font-mono text-sm">LeagueId: {leagueId}</p>
          </div>
          <Link href="/bowler-dashboard" className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-white">
            Return to Dashboard
          </Link>
        </div>
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

        {/* Six detailed payment cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Weekly Fee</CardTitle>
              <CardDescription>Regular payment amount</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">${((league?.weeklyFee || 0) / 100).toFixed(2)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Amount Due to Date</CardTitle>
              <CardDescription>
                {weeksDue} week{weeksDue === 1 ? "" : "s"} at ${(
                  (league?.weeklyFee || 0) / 100
                ).toFixed(2)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">${(totalSeasonDues / 100).toFixed(2)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Amount Paid to Date</CardTitle>
              <CardDescription>All payments received</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">${(totalPaidAmount / 100).toFixed(2)}</p>
            </CardContent>
          </Card>

          <Link href="/bowler-dashboard">
            <Card className="cursor-pointer transition-colors hover:border-destructive/50 hover:bg-destructive/5">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Amount Past Due to Date</CardTitle>
                <CardDescription>Unpaid fees for weeks passed — click to make a payment</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-destructive">${(amountPastDue / 100).toFixed(2)}</p>
              </CardContent>
            </Card>
          </Link>

          {/* Replaced Card Component */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Full Season Lineage Amount Due</CardTitle>
              <CardDescription>
                {totalWeeksInSeason} week{totalWeeksInSeason === 1 ? "" : "s"} at ${(
                  (league?.weeklyFee || 0) / 100
                ).toFixed(2)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">${(fullSeasonAmount / 100).toFixed(2)}</p>
            </CardContent>
          </Card>

          {/* Replaced Card Component */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Full Season Remaining Balance</CardTitle>
              <CardDescription>Amount left to pay</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">${(remainingBalance / 100).toFixed(2)}</p>
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
                          <Badge variant={payment.status === 'paid' ? 'default' : 'destructive'}>
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