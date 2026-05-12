import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageLoadingState, PageErrorState } from "@/components/page-states";
import type { League, User, ApiResponse } from "@shared/schema";

export default function SecretaryLeaguesPage() {
  const { data, isLoading, error } = useQuery<{ success: true; data: League[] }>({
    queryKey: ["/api/me/league-secretary-leagues"],
    queryFn: async () => {
      const res = await fetch("/api/me/league-secretary-leagues");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });
  // Task #735: bowler ↔ secretary toggle. A user who is BOTH a bowler
  // and a secretary should be able to switch between their two
  // surfaces in one click. We surface the link only when bowlerId is
  // present so non-bowlers don't see a dead-end button.
  const { data: meResponse } = useQuery<ApiResponse<User>>({
    queryKey: ["/api/user"],
  });
  const hasBowlerProfile = !!meResponse?.data?.bowlerId;

  if (isLoading) return <Layout><PageLoadingState /></Layout>;
  if (error) return <Layout><PageErrorState message="Failed to load your leagues" /></Layout>;

  const leagues = data?.data ?? [];

  return (
    <Layout>
      <div className="container mx-auto p-4 sm:p-6 max-w-3xl">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle>My Leagues</CardTitle>
                <CardDescription>
                  Leagues you administer as a secretary.
                </CardDescription>
              </div>
              {hasBowlerProfile && (
                <Button asChild variant="outline" size="sm" data-testid="link-bowler-dashboard">
                  <Link href="/bowler-dashboard">Bowler view</Link>
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {leagues.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You have not been granted secretary access to any leagues.
              </p>
            ) : (
              <ul className="divide-y rounded border">
                {leagues.map((l) => (
                  <li key={l.id} className="p-3" data-testid={`secretary-league-${l.id}`}>
                    <Link
                      href={`/leagues/${l.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {l.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
