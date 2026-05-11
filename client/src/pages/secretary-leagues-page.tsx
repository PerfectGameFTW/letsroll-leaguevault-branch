import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { PageLoadingState, PageErrorState } from "@/components/page-states";
import type { League } from "@shared/schema";

export default function SecretaryLeaguesPage() {
  const { data, isLoading, error } = useQuery<{ success: true; data: League[] }>({
    queryKey: ["/api/me/league-secretary-leagues"],
    queryFn: async () => {
      const res = await fetch("/api/me/league-secretary-leagues");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  if (isLoading) return <Layout><PageLoadingState /></Layout>;
  if (error) return <Layout><PageErrorState message="Failed to load your leagues" /></Layout>;

  const leagues = data?.data ?? [];

  return (
    <Layout>
      <div className="container mx-auto p-4 sm:p-6 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>My Leagues</CardTitle>
            <CardDescription>
              Leagues you administer as a secretary.
            </CardDescription>
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
