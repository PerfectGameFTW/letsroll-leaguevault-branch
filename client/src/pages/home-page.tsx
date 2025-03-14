import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Layout } from "@/components/layout";
import { Loader2, AlertCircle, Trophy, Users, TrendingUp, DollarSign } from "lucide-react";
import { Link } from "wouter";
import type { Bowler, League, Payment, ApiResponse } from "@shared/schema";
import { PastDueBowlersSection } from "@/components/past-due-bowlers-section";
import { PaymentDistributionChart } from "@/components/payment-distribution-chart";
import { formatCurrency } from "@/lib/utils";

// Cache time constants
const CACHE_TIME = 1000 * 30; // 30 seconds

function LoadingState() {
  return (
    <Layout>
      <div className="flex items-center justify-center h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    </Layout>
  );
}

function ErrorState({ error }: { error: Error }) {
  return (
    <Layout>
      <div className="p-4 rounded-md bg-destructive/10 text-destructive flex items-center gap-2">
        <AlertCircle className="h-5 w-5" />
        <p>Error loading data: {error.message}</p>
      </div>
    </Layout>
  );
}

export default function HomePage() {
  const { data: bowlersResponse, isLoading: loadingBowlers, error: bowlersError } = useQuery<ApiResponse<Bowler[]>>({
    queryKey: ["/api/bowlers"],
    staleTime: CACHE_TIME,
    retry: false,
  });

  const { data: leaguesResponse, isLoading: loadingLeagues, error: leaguesError } = useQuery<ApiResponse<League[]>>({
    queryKey: ["/api/leagues"],
    staleTime: CACHE_TIME,
    retry: false,
  });
  
  const { data: paymentsResponse, isLoading: loadingPayments, error: paymentsError } = useQuery<ApiResponse<Payment[]>>({
    queryKey: ["/api/payments"],
    staleTime: CACHE_TIME,
    retry: false,
  });

  // Show loading state only when initial data is loading
  if (loadingBowlers || loadingLeagues || loadingPayments) {
    return <LoadingState />;
  }

  // Handle errors
  const error = bowlersError || leaguesError || paymentsError;
  if (error) {
    console.error('Home page error:', error);
    return <ErrorState error={error as Error} />;
  }

  const bowlers = bowlersResponse?.data || [];
  const leagues = leaguesResponse?.data || [];
  const payments = paymentsResponse?.data || [];
  
  const activeBowlers = bowlers.filter((b: Bowler) => b.active).length;
  const totalLeagues = leagues.length;

  // Calculate lineage and prize fund totals
  const paidPayments = payments.filter(p => p.status === 'paid');
  const totalLineagePaid = paidPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
  
  // For this example, we're using half of total payments for prize fund
  // In a real app, this would be calculated based on specific payment types or categories
  const totalPrizeFundPaid = Math.floor(totalLineagePaid * 0.5);

  return (
    <Layout>
      <div className="space-y-8">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {/* League Card */}
          <Link href="/leagues" className="block transition-transform hover:scale-105">
            <Card className="cursor-pointer hover:border-primary h-full">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Leagues</CardTitle>
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

        {/* On mobile: full width for each section, on tablet+: side by side */}
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
          {/* On mobile and desktop: payment chart with the same width as cards above */}
          <div className="col-span-1 md:col-span-1">
            <PaymentDistributionChart payments={payments} activeBowlersCount={activeBowlers} />
          </div>
          <div className="col-span-1 md:col-span-1">
            <PastDueBowlersSection />
          </div>
        </div>
      </div>
    </Layout>
  );
}