import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Layout } from "@/components/layout";
import { Loader2, ArrowLeft, ExternalLink } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Bowler, Payment } from "@shared/schema";
import { format } from "date-fns";

export default function BowlerViewPage() {
  const params = useParams();
  const bowlerId = parseInt(params.bowlerId!);

  const { data: bowler, isLoading: loadingBowler } = useQuery<Bowler>({
    queryKey: [`/api/bowlers/${bowlerId}`],
  });

  const { data: payments, isLoading: loadingPayments } = useQuery<Payment[]>({
    queryKey: ["/api/payments", bowlerId],
    queryFn: () =>
      fetch(`/api/payments?bowlerId=${bowlerId}`).then((res) => res.json()),
  });

  if (loadingBowler || loadingPayments) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!bowler) {
    return (
      <Layout>
        <div className="text-center">Bowler not found</div>
      </Layout>
    );
  }

  // Calculate financial summary
  const totalPaidPayments = payments?.filter(p => p.status === 'paid') || [];
  const totalPaidAmount = totalPaidPayments.reduce((sum, p) => sum + p.amount, 0);
  const totalUnpaidPayments = payments?.filter(p => p.status !== 'paid') || [];
  const totalUnpaidAmount = totalUnpaidPayments.reduce((sum, p) => sum + p.amount, 0);

  // Assuming weekly fee is charged for the entire season
  const weeksInSeason = 32; // You may want to make this dynamic based on league settings
  const totalSeasonDues = bowler.weeklyFee * weeksInSeason;
  const remainingBalance = totalSeasonDues - totalPaidAmount;

  return (
    <Layout>
      <div className="mb-6">
        <Link
          href={`/teams/${bowler.teamId}`}
          className="text-muted-foreground hover:text-foreground flex items-center mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Team
        </Link>
        <div className="flex flex-col gap-4 mb-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">{bowler.name}</h1>
            <p className="text-muted-foreground">{bowler.email}</p>
          </div>
          <div className="flex items-center gap-4">
            <div>
              <span className="text-muted-foreground">Weekly Fee:</span>{" "}
              <span className="font-medium">
                ${(bowler.weeklyFee / 100).toFixed(2)}
              </span>
            </div>
            <Badge variant={bowler.active ? "default" : "secondary"}>
              {bowler.active ? "Active" : "Inactive"}
            </Badge>
          </div>
        </div>

        {/* Financial Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Amount Due to Date</CardTitle>
              <CardDescription>Current season charges</CardDescription>
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

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Amount Past Due</CardTitle>
              <CardDescription>Unpaid fees</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-destructive">${(totalUnpaidAmount / 100).toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Total Season Dues</CardTitle>
              <CardDescription>Full season charges</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">${(totalSeasonDues / 100).toFixed(2)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Remaining Balance</CardTitle>
              <CardDescription>Amount left to pay</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-orange-600">${(remainingBalance / 100).toFixed(2)}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Transaction ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center">
                  No payment history
                </TableCell>
              </TableRow>
            ) : (
              payments?.map((payment) => (
                <TableRow key={payment.id}>
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
                    <div className="flex items-center gap-2">
                      {payment.squarePaymentId ? (
                        <>
                          <span className="font-mono text-sm">
                            {payment.squarePaymentId}
                          </span>
                          <a
                            href={`https://squareup.com/dashboard/payments/${payment.squarePaymentId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                            title="View in Square Dashboard"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </>
                      ) : (
                        <span className="text-muted-foreground">N/A</span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Layout>
  );
}