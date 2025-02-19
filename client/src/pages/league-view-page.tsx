import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Loader2, Users, CircleDollarSign, Trophy } from "lucide-react";
import type { League } from "@shared/schema";
import { useParams, Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function LeagueViewPage() {
  const params = useParams();
  const { toast } = useToast();
  const leagueId = parseInt(params.leagueId!);

  const { data: leagueResponse, isLoading, error } = useQuery<{ success: true; data: League }>({
    queryKey: [`/api/leagues/${leagueId}`],
    queryFn: async () => {
      console.log('[LeagueViewPage] Fetching league:', leagueId);
      const response = await fetch(`/api/leagues/${leagueId}`);
      if (!response.ok) {
        console.error('[LeagueViewPage] Failed to fetch league:', await response.text());
        throw new Error('Failed to fetch league');
      }
      const data = await response.json();
      console.log('[LeagueViewPage] League response:', data);
      return data;
    },
    retry: false
  });

  // Access the league data from the nested structure
  const league = leagueResponse?.data;
  console.log('[LeagueViewPage] Processed league data:', league);

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="text-center">
          <h2 className="text-xl font-semibold text-destructive">Error loading league</h2>
          <p className="text-muted-foreground">{error instanceof Error ? error.message : 'Unknown error occurred'}</p>
        </div>
      </Layout>
    );
  }

  if (!league) {
    return (
      <Layout>
        <div className="text-center">
          <h2 className="text-xl font-semibold text-destructive">League not found</h2>
          <p className="text-muted-foreground">The requested league could not be found</p>
          <Link href="/leagues" className="text-primary hover:underline mt-4 inline-block">
            Return to Leagues
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{league.name}</h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Link href={`/leagues/${leagueId}/teams`} className="block">
            <Card className="hover:bg-accent transition-colors">
              <CardHeader>
                <div className="flex justify-center mb-2">
                  <Users className="h-6 w-6" />
                </div>
                <CardTitle>Roster Management</CardTitle>
                <CardDescription>
                  Manage bowlers and teams in your league
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Add or remove bowlers, organize team rosters, and manage team assignments
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href={`/leagues/${leagueId}/weekly-payments`} className="block">
            <Card className="hover:bg-accent transition-colors">
              <CardHeader>
                <div className="flex justify-center mb-2">
                  <CircleDollarSign className="h-6 w-6" />
                </div>
                <CardTitle>Weekly Payments</CardTitle>
                <CardDescription>
                  Log and track weekly cash/check payments
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Record manual payments by team and week, view payment history
                </p>
              </CardContent>
            </Card>
          </Link>

          <Link href={`/leagues/${leagueId}/scores`} className="block">
            <Card className="hover:bg-accent transition-colors">
              <CardHeader>
                <div className="flex justify-center mb-2">
                  <Trophy className="h-6 w-6" />
                </div>
                <CardTitle>Weekly Scores</CardTitle>
                <CardDescription>
                  View and track weekly bowling scores
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Access detailed weekly scores, statistics and performance tracking
                </p>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </Layout>
  );
}