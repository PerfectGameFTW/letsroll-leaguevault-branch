import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Layout } from "@/components/layout";
import { Trophy, Users, TrendingUp, DollarSign } from "lucide-react";
import { Link } from "wouter";
import type { League, Payment, BowlerLeague, ApiResponse, Organization, User } from "@shared/schema";
import { PastDueBowlersSection } from "@/components/past-due-bowlers-section";
import { formatCurrency } from "@/lib/utils";
import { ErrorBoundary } from "@/components/error-boundary";
import { PageLoadingState, PageErrorState } from "@/components/page-states";

export default function HomePage() {
  const { data: leaguesResponse, isLoading: loadingLeagues, error: leaguesError } = useQuery<ApiResponse<League[]>>({
    queryKey: ["/api/leagues"],
    staleTime: 1000 * 30,
    retry: false,
  });
  
  const { data: paymentsResponse, isLoading: loadingPayments, error: paymentsError } = useQuery<ApiResponse<Payment[]>>({
    queryKey: ["/api/payments"],
    staleTime: 1000 * 30,
    retry: false,
  });
  
  const { data: bowlerLeaguesResponse, isLoading: loadingBowlerLeagues, error: bowlerLeaguesError } = useQuery<ApiResponse<BowlerLeague[]>>({
    queryKey: ["/api/bowler-leagues"],
    staleTime: 1000 * 30,
    retry: false,
  });

  const { data: userResponse } = useQuery<ApiResponse<User>>({
    queryKey: ["/api/user"],
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  const organizationId = userResponse?.data?.organizationId;

  const { data: orgResponse } = useQuery<ApiResponse<Organization>>({
    queryKey: [`/api/organizations/${organizationId}`],
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  // Show loading state only when initial data is loading
  if (loadingLeagues || loadingPayments || loadingBowlerLeagues) {
    return <Layout><PageLoadingState /></Layout>;
  }

  const error = leaguesError || paymentsError || bowlerLeaguesError;
  if (error) {
    return <Layout><PageErrorState message={`Error loading data: ${(error as Error).message}`} /></Layout>;
  }

  const leagues = leaguesResponse?.data || [];
  const payments = paymentsResponse?.data || [];
  const bowlerLeaguesData = bowlerLeaguesResponse?.data || [];

  const activeLeagueIds = new Set(leagues.filter((l: League) => l.active).map((l: League) => l.id));
  const activeBowlers = new Set(
    bowlerLeaguesData
      .filter((bl: BowlerLeague) => bl.active && activeLeagueIds.has(bl.leagueId))
      .map((bl: BowlerLeague) => bl.bowlerId)
  ).size;
  const totalLeagues = activeLeagueIds.size;

  // Calculate lineage and prize fund totals from actual tracked amounts
  const paidPayments = payments.filter(p => p.status === 'paid');
  const totalLineagePaid = paidPayments.reduce((sum, p) => sum + (p.lineageAmount ?? 0), 0);
  const totalPrizeFundPaid = paidPayments.reduce((sum, p) => sum + (p.prizeFundAmount ?? 0), 0);

  // Get the organization data with the logo
  const organization = orgResponse?.data;

  return (
    <Layout>
      <ErrorBoundary level="section">
      <div className="space-y-8">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {/* League Card */}
          <Link href="/leagues" className="block transition-transform hover:scale-105">
            <Card className="cursor-pointer hover:border-primary h-full">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Leagues</CardTitle>
                <Trophy className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalLeagues}</div>
              </CardContent>
            </Card>
          </Link>
          
          {/* Active Bowlers Card */}
          <Link href="/bowlers" className="block transition-transform hover:scale-105">
            <Card className="cursor-pointer hover:border-primary h-full">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Bowlers</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{activeBowlers}</div>
              </CardContent>
            </Card>
          </Link>

          {/* Lineage Paid Card */}
          <Link href="/payments" className="block transition-transform hover:scale-105">
            <Card className="cursor-pointer hover:border-primary h-full">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Lineage Paid</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(totalLineagePaid)}</div>
              </CardContent>
            </Card>
          </Link>

          {/* Prize Fund Card */}
          <Link href="/payments" className="block transition-transform hover:scale-105">
            <Card className="cursor-pointer hover:border-primary h-full">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Prize Fund Paid</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{formatCurrency(totalPrizeFundPaid)}</div>
              </CardContent>
            </Card>
          </Link>
        </div>

        <ErrorBoundary level="section">
          <PastDueBowlersSection />
        </ErrorBoundary>
      </div>
      </ErrorBoundary>
    </Layout>
  );
}