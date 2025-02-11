import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link href={`/leagues/${leagueId}/teams`}>
            <Button className="w-full" variant="outline">
              <Users className="h-4 w-4 mr-2" />
              Manage Teams
            </Button>
          </Link>

          <Link href={`/leagues/${leagueId}/weekly-payments`}>
            <Button className="w-full" variant="outline">
              <DollarSign className="h-4 w-4 mr-2" />
              Weekly Payments
            </Button>
          </Link>
        </div>
      </div>
    </Layout>
  );
}