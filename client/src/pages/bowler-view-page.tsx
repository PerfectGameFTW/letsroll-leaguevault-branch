import { useState, useEffect } from "react";  
import { useQuery, useMutation } from "@tanstack/react-query";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { Bowler, Payment, Team, League, BowlerLeague } from "@shared/schema";
import { format, differenceInWeeks, startOfToday } from "date-fns";
import { enrollInLoyalty, getLoyaltyPoints } from "@/lib/square";

interface LoyaltyInfo {
  points: number;
  lifetimePoints: number;
  enrolledAt: string;
}

export default function BowlerViewPage() {
  const params = useParams();
  const { toast } = useToast();
  const bowlerId = parseInt(params.bowlerId!);
  const [selectedLeagueId, setSelectedLeagueId] = useState<number | null>(null);

  // Query for bowler with proper typing and error handling
  const { data: bowlerResponse, isLoading: loadingBowler } = useQuery<{ data: Bowler }>({
    queryKey: [`/api/bowlers/${bowlerId}`],
    retry: false,
    queryFn: async () => {
      const response = await fetch(`/api/bowlers/${bowlerId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch bowler');
      }
      return response.json();
    }
  });
  const bowler = bowlerResponse?.data;

  // Query to get bowler's league associations with proper typing
  const { data: bowlerLeaguesResponse, isLoading: loadingBowlerLeagues } = useQuery<{ data: BowlerLeague[] }>({
    queryKey: ["/api/bowler-leagues", bowlerId],
    retry: false,
    queryFn: async () => {
      const response = await fetch(`/api/bowler-leagues?bowlerId=${bowlerId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch bowler leagues');
      }
      return response.json();
    },
    enabled: !!bowlerId
  });
  const bowlerLeagues = bowlerLeaguesResponse?.data || [];

  // Get all leagues the bowler is in
  const { data: leaguesResponse, isLoading: loadingLeagues } = useQuery<{ data: League[] }>({
    queryKey: ["/api/leagues"],
    retry: false,
    queryFn: async () => {
      const response = await fetch('/api/leagues');
      if (!response.ok) {
        throw new Error('Failed to fetch leagues');
      }
      return response.json();
    },
    enabled: !!bowlerLeagues.length
  });
  const leagues = leaguesResponse?.data || [];

  // Get the selected league's team
  const selectedAssociation = bowlerLeagues.find(bl => bl.leagueId === selectedLeagueId);

  const { data: teamResponse, isLoading: loadingTeam } = useQuery<{ data: Team }>({
    queryKey: [`/api/teams/${selectedAssociation?.teamId}`],
    retry: false,
    queryFn: async () => {
      if (!selectedAssociation?.teamId) {
        throw new Error('No team ID selected');
      }
      const response = await fetch(`/api/teams/${selectedAssociation.teamId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch team');
      }
      return response.json();
    },
    enabled: !!selectedAssociation?.teamId,
  });
  const team = teamResponse?.data;

  const { data: league, isLoading: loadingLeague } = useQuery<{ data: League }>({
    queryKey: [`/api/leagues/${selectedLeagueId}`],
    retry: false,
    queryFn: async () => {
      if (!selectedLeagueId) {
        throw new Error('No league ID selected');
      }
      const response = await fetch(`/api/leagues/${selectedLeagueId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch league');
      }
      return response.json();
    },
    enabled: !!selectedLeagueId,
  });

  const { data: paymentsResponse, isLoading: loadingPayments } = useQuery<{ data: Payment[] }>({
    queryKey: ["/api/payments", bowlerId, selectedLeagueId],
    retry: false,
    queryFn: async () => {
      const response = await fetch(`/api/payments?bowlerId=${bowlerId}&leagueId=${selectedLeagueId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch payments');
      }
      return response.json();
    },
    enabled: !!selectedLeagueId,
  });

  const payments = paymentsResponse?.data || [];

  // Add loyalty points query
  const { data: loyaltyInfo, isLoading: loadingLoyalty } = useQuery<LoyaltyInfo>({
    queryKey: ["/api/square/loyalty", bowler?.squareCustomerId],
    queryFn: () => {
      if (!bowler?.squareCustomerId) {
        throw new Error("No Square customer ID");
      }
      return getLoyaltyPoints(bowler.squareCustomerId);
    },
    enabled: !!bowler?.squareCustomerId,
    retry: false,
  });

  // Update initialization logic for selectedLeagueId
  useEffect(() => {
    if (bowlerLeagues?.length && !selectedLeagueId) {
      // Sort by order and take the first league
      const sortedLeagues = [...bowlerLeagues].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      setSelectedLeagueId(sortedLeagues[0].leagueId);
    }
  }, [bowlerLeagues, selectedLeagueId]);

  // Add enroll mutation
  const enrollMutation = useMutation({
    mutationFn: async () => {
      if (!bowler?.squareCustomerId) {
        throw new Error("No Square customer ID");
      }
      return enrollInLoyalty(bowler.squareCustomerId);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Successfully enrolled in loyalty program",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to enroll",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (loadingBowler || loadingBowlerLeagues || loadingPayments || loadingTeam || loadingLeague || loadingLoyalty || loadingLeagues) {
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

  // Financial calculations based on selected league
  const totalPaidPayments = payments.filter(p => p.status === 'paid') || [];
  const totalPaidAmount = totalPaidPayments.reduce((sum, p) => sum + p.amount, 0);
  const totalUnpaidPayments = payments.filter(p => p.status !== 'paid') || [];
  const totalUnpaidAmount = totalUnpaidPayments.reduce((sum, p) => sum + p.amount, 0);

  let weeksDue = 0;
  let totalSeasonDues = 0;
  let totalWeeksInSeason = 0;
  let fullSeasonAmount = 0;
  let amountPastDue = 0;

  if (league?.data?.seasonStart && league.data.seasonEnd && league.data.weeklyFee) {
    const seasonStart = new Date(league.data.seasonStart);
    const today = startOfToday();
    const seasonEnd = new Date(league.data.seasonEnd);

    if (today < seasonStart) {
      weeksDue = 0;
    } else if (today > seasonEnd) {
      weeksDue = Math.max(0, differenceInWeeks(seasonEnd, seasonStart));
    } else {
      weeksDue = Math.max(0, differenceInWeeks(today, seasonStart));
    }

    totalSeasonDues = league.data.weeklyFee * weeksDue;
    totalWeeksInSeason = differenceInWeeks(seasonEnd, seasonStart);
    fullSeasonAmount = league.data.weeklyFee * totalWeeksInSeason;
    amountPastDue = totalSeasonDues - totalPaidAmount;
  }

  const remainingBalance = fullSeasonAmount - totalPaidAmount;

  // Update bowlerLeaguesFiltered to maintain order
  const bowlerLeaguesFiltered = bowlerLeagues?.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .filter(bl => {
      const leagueInfo = leagues?.find(l => l.id === bl.leagueId);
      return leagueInfo;
    });

  return (
    <Layout>
      <div className="mb-6">
        {selectedAssociation && (
          <Link
            href={`/teams/${selectedAssociation.teamId}`}
            className="text-muted-foreground hover:text-foreground flex items-center mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Team
          </Link>
        )}
        <div className="flex flex-col gap-2 mb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{bowler?.name}</h1>
              <Badge variant={bowler?.active ? "default" : "secondary"}>
                {bowler?.active ? "Active" : "Inactive"}
              </Badge>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Select
              value={selectedLeagueId?.toString() || ""}
              onValueChange={(value) => setSelectedLeagueId(parseInt(value))}
            >
              <SelectTrigger className="w-[300px]">
                <SelectValue placeholder="Select a league" />
              </SelectTrigger>
              <SelectContent>
                {bowlerLeagues.map((bl) => {
                  const leagueInfo = leagues?.find(l => l.id === bl.leagueId);
                  return leagueInfo ? (
                    <SelectItem key={bl.leagueId} value={bl.leagueId.toString()}>
                      {leagueInfo.name}
                    </SelectItem>
                  ) : null;
                })}
              </SelectContent>
            </Select>
            {team && (
              <div className="font-medium text-muted-foreground">
                {team.name}
              </div>
            )}
          </div>
        </div>

        {/* Loyalty Program Section */}
        {bowler.squareCustomerId && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-4">Loyalty Program</h2>
            {loadingLoyalty ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading loyalty information...</span>
              </div>
            ) : loyaltyInfo ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Current Points</CardTitle>
                    <CardDescription>Available to redeem</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">{loyaltyInfo.points}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Lifetime Points</CardTitle>
                    <CardDescription>Total points earned</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">{loyaltyInfo.lifetimePoints}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Member Since</CardTitle>
                    <CardDescription>Enrollment date</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">
                      {format(new Date(loyaltyInfo.enrolledAt), "MMM d, yyyy")}
                    </p>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <p className="text-muted-foreground">Not enrolled in loyalty program</p>
                <Button
                  onClick={() => enrollMutation.mutate()}
                  disabled={enrollMutation.isPending}
                >
                  {enrollMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Enroll Now
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Financial Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Weekly Fee</CardTitle>
              <CardDescription>Regular payment amount</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">${((league?.data?.weeklyFee || 0) / 100).toFixed(2)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Amount Due to Date</CardTitle>
              <CardDescription>
                {weeksDue} week{weeksDue === 1 ? "" : "s"} at ${(
                  (league?.data?.weeklyFee || 0) / 100
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

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Amount Past Due to Date</CardTitle>
              <CardDescription>Unpaid fees for weeks passed</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-destructive">${(amountPastDue / 100).toFixed(2)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Full Season Lineage Amount Due</CardTitle>
              <CardDescription>
                {totalWeeksInSeason} week{totalWeeksInSeason === 1 ? "" : "s"} at ${(
                  (league?.data?.weeklyFee || 0) / 100
                ).toFixed(2)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-orange-600">${(fullSeasonAmount / 100).toFixed(2)}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Full Season Remaining Balance</CardTitle>
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