import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Layout } from "@/components/layout";
import { Loader2 } from "lucide-react";
import { Link } from "wouter";
import type { Bowler, League } from "@shared/schema";

export default function HomePage() {
  const { data: bowlersResponse, isLoading: loadingBowlers } = useQuery<{ data: Bowler[] }>({
    queryKey: ["/api/bowlers"],
    queryFn: async () => {
      const response = await fetch("/api/bowlers");
      if (!response.ok) {
        throw new Error('Failed to fetch bowlers');
      }
      const json = await response.json();
      return json;
    }
  });

  const { data: leaguesResponse, isLoading: loadingLeagues } = useQuery<{ data: League[] }>({
    queryKey: ["/api/leagues"],
    queryFn: async () => {
      const response = await fetch("/api/leagues");
      if (!response.ok) {
        throw new Error('Failed to fetch leagues');
      }
      return response.json();
    }
  });

  const bowlers = bowlersResponse?.data || [];
  const leagues = leaguesResponse?.data || [];
  const activeBowlers = bowlers.filter(b => b.active).length;
  const totalLeagues = leagues.length;

  if (loadingBowlers || loadingLeagues) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

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