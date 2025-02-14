import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Loader2, Users, DollarSign } from "lucide-react";
import type { League } from "@shared/schema";
import { useParams, Link } from "wouter";

export default function LeagueViewPage() {
  const params = useParams();
  const leagueId = parseInt(params.leagueId!);

  const { data: leagueResponse, isLoading } = useQuery<{ data: League }>({
    queryKey: [`/api/leagues/${leagueId}`],
  });

  const league = leagueResponse?.data;

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!league) {
    return (
      <Layout>
        <div className="text-center">League not found</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{league.name}</h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Link href={`/leagues/${leagueId}/teams`} className="block">
            <Card className="hover:bg-accent transition-colors">
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Users className="h-5 w-5 mr-2" />
                  Roster Management
                </CardTitle>
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
                <CardTitle className="flex items-center">
                  <DollarSign className="h-5 w-5 mr-2" />
                  Weekly Payments
                </CardTitle>
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
        </div>
      </div>
    </Layout>
  );
}