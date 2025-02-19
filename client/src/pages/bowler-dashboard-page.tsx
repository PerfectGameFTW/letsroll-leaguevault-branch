import { FC, Suspense, lazy } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useBowlers } from "@/hooks/use-bowlers";
import { useQuery } from "@tanstack/react-query";
import type { User } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Menu, AlertCircle, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useState } from "react";
import { startOfToday, differenceInWeeks } from "date-fns";

// Lazy load components
const SideNav = lazy(() => import("@/components/bowler-dashboard/side-nav"));

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    message: string;
    code?: string;
  };
}

export const BowlerDashboardPage: FC = () => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const { data: currentUserResponse, isLoading: isUserLoading } = useQuery<ApiResponse<User>>({
    queryKey: ["/api/user"],
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });

  const {
    bowlers,
    getBowlerTeamName,
    getBowlerFirstLeagueName,
    isInitialLoading,
    isLoadingRelatedData,
    getBowlerLeagueId
  } = useBowlers({
    isEnabled: !!currentUserResponse?.data?.bowlerId,
  });

  const currentUser = currentUserResponse?.data;
  const bowler = currentUser?.bowlerId ? bowlers.find(b => b.id === currentUser.bowlerId) : null;
  const leagueId = bowler ? getBowlerLeagueId(bowler) : null;

  // Get league and payment data for status checks
  const { data: combinedData, isLoading: isCombinedLoading } = useQuery({
    queryKey: [`/api/dashboard-data`, leagueId],
    enabled: !!leagueId,
    queryFn: async () => {
      if (!leagueId) throw new Error('League ID is required');

      try {
        const [leagueRes, paymentsRes] = await Promise.all([
          fetch(`/api/leagues/${leagueId}`),
          fetch(`/api/payments?bowlerId=${bowler?.id}&leagueId=${leagueId}`)
        ]);

        if (!leagueRes.ok || !paymentsRes.ok) {
          throw new Error('Failed to fetch dashboard data');
        }

        const [leagueData, paymentsData] = await Promise.all([
          leagueRes.json(),
          paymentsRes.json()
        ]);

        return {
          league: leagueData.data,
          payments: paymentsData.data
        };
      } catch (error) {
        console.error('[BowlerDashboard] Data fetch error:', error);
        throw error;
      }
    },
    staleTime: 1000 * 60 * 5,
  });

  const league = combinedData?.league;
  const payments = combinedData?.payments || [];

  // Calculate only what's needed for payment status
  const totalPaidAmount = payments
    .filter(p => p.status === 'paid')
    .reduce((sum, p) => sum + p.amount, 0);

  let amountPastDue = 0;

  if (league?.seasonStart && league.seasonEnd && league.weeklyFee) {
    const seasonStart = new Date(league.seasonStart);
    const seasonEnd = new Date(league.seasonEnd);
    const today = startOfToday();

    const weeksDue = today < seasonStart ? 0 :
                    today > seasonEnd ? Math.max(0, differenceInWeeks(seasonEnd, seasonStart)) :
                    Math.max(0, differenceInWeeks(today, seasonStart));

    const totalSeasonDues = league.weeklyFee * weeksDue;
    amountPastDue = Math.max(0, totalSeasonDues - totalPaidAmount);
  }

  if (isUserLoading || isInitialLoading || isLoadingRelatedData || isCombinedLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <Card className="mx-auto max-w-md mt-8">
        <CardHeader>
          <CardTitle>Authentication Required</CardTitle>
          <CardDescription>Please log in to view your dashboard</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            You need to be logged in to access your bowler dashboard.
          </p>
          <Link href="/login">
            <Button className="w-full">Log In</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (!bowler) {
    return (
      <Card className="mx-auto max-w-md mt-8">
        <CardHeader>
          <CardTitle>Profile Setup Required</CardTitle>
          <CardDescription>Your bowler profile needs to be configured</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Please contact a league administrator to set up your bowler profile.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Desktop Navigation */}
      <aside className="hidden lg:block w-64 border-r px-4 py-6">
        <div className="mb-6">
          <h2 className="text-lg font-semibold">{bowler.name}</h2>
          <p className="text-sm text-muted-foreground">{getBowlerFirstLeagueName(bowler)}</p>
        </div>
        <Suspense fallback={<div>Loading navigation...</div>}>
          <SideNav />
        </Suspense>
      </aside>

      {/* Mobile Navigation */}
      <div className="lg:hidden fixed top-4 left-4 z-50">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon">
              <Menu className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64">
            <div className="mb-6">
              <h2 className="text-lg font-semibold">{bowler.name}</h2>
              <p className="text-sm text-muted-foreground">{getBowlerFirstLeagueName(bowler)}</p>
            </div>
            <Suspense fallback={<div>Loading navigation...</div>}>
              <SideNav />
            </Suspense>
          </SheetContent>
        </Sheet>
      </div>

      {/* Main Content */}
      <main className="flex-1 px-4 py-6">
        <div className="space-y-6">
          {/* Dashboard Overview Card */}
          <Card>
            <CardHeader>
              <CardTitle>{bowler.name}'s Dashboard</CardTitle>
              <CardDescription>League and team information</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground">League</h3>
                    <p className="mt-1 text-lg">{getBowlerFirstLeagueName(bowler)}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground">Team</h3>
                    <p className="mt-1 text-lg">{getBowlerTeamName(bowler)}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Payment Status Card */}
          <Card>
            <CardHeader>
              <CardTitle>Payment Status</CardTitle>
              <CardDescription>Current payment information for {league?.name}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h3 className="text-lg font-semibold">Payment Setup</h3>
                    <p className="text-sm text-muted-foreground">
                      {bowler?.squareCustomerId
                        ? "Your payment method is configured"
                        : "Set up your payment method to enable automatic payments"}
                    </p>
                  </div>

                  <Link href={`/bowlers/${bowler.id}/payment-setup`}>
                    <Button>
                      {bowler?.squareCustomerId ? "Update Payment Method" : "Set Up Payments"}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                </div>

                {amountPastDue > 0 && (
                  <div className="rounded-md bg-destructive/10 p-4">
                    <div className="flex items-start">
                      <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-destructive">Payment Past Due</h3>
                        <div className="mt-1 text-sm text-destructive">
                          <p>You have an outstanding balance of ${(amountPastDue / 100).toFixed(2)}.</p>
                          <p className="mt-2">Please make a payment to maintain your active status in the league.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default BowlerDashboardPage;