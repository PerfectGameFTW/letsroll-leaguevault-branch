import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Layout } from "@/components/layout";
import { Loader2, AlertCircle } from "lucide-react";
import { Link } from "wouter";
import type { Bowler, League, ApiResponse } from "@shared/schema";

// Cache time constants
const CACHE_TIME = 1000 * 60 * 5; // 5 minutes

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
    gcTime: CACHE_TIME * 2,
    retry: 1,
  });

  const { data: leaguesResponse, isLoading: loadingLeagues, error: leaguesError } = useQuery<ApiResponse<League[]>>({
    queryKey: ["/api/leagues"],
    staleTime: CACHE_TIME,
    gcTime: CACHE_TIME * 2,
    retry: 1,
  });

  // Show loading state only when initial data is loading
  if (loadingBowlers || loadingLeagues) {
    return <LoadingState />;
  }

  const error = bowlersError || leaguesError;
  if (error) {
    return <ErrorState error={error as Error} />;
  }

  const bowlers = bowlersResponse?.data || [];
  const leagues = leaguesResponse?.data || [];
  const activeBowlers = bowlers.filter((b: Bowler) => b.active).length;
  const totalLeagues = leagues.length;

  return (
    <Layout>
      <div className="grid gap-4 md:grid-cols-2">
        <Link href="/leagues" className="block transition-transform hover:scale-105">
          <Card className="cursor-pointer hover:border-primary">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Leagues</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalLeagues}</div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/bowlers" className="block transition-transform hover:scale-105">
          <Card className="cursor-pointer hover:border-primary">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Bowlers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{activeBowlers}</div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </Layout>
  );
}