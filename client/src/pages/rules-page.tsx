import { useQuery } from "@tanstack/react-query";
import { BowlerLayout } from "@/components/bowler-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import type { League } from "@shared/schema";

export default function RulesPage() {
  // Get current user and their bowler ID
  const { data: currentUser } = useQuery<{ success: true; data: { bowlerId: number } }>({
    queryKey: ["/api/user"],
  });

  const bowlerId = currentUser?.data?.bowlerId;

  // Get bowler details
  const { data: bowlerResponse } = useQuery<{ success: true; data: { name: string } }>({
    queryKey: [`/api/bowlers/${bowlerId}`],
    enabled: !!bowlerId,
  });

  // Get league information for the bowler
  const { data: bowlerLeaguesResponse } = useQuery<{ success: true; data: { leagueId: number }[] }>({
    queryKey: ["/api/bowler-leagues", bowlerId],
    enabled: !!bowlerId,
  });

  const leagueId = bowlerLeaguesResponse?.data?.[0]?.leagueId;

  // Get league details
  const { data: leagueResponse, isLoading: loadingLeague } = useQuery<{ success: true; data: League }>({
    queryKey: [`/api/leagues/${leagueId}`],
    enabled: !!leagueId,
  });

  const league = leagueResponse?.data;
  const bowlerName = bowlerResponse?.data?.name;

  if (loadingLeague) {
    return (
      <BowlerLayout bowlerName={bowlerName} leagueName={league?.name}>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </BowlerLayout>
    );
  }

  if (!league) {
    return (
      <BowlerLayout bowlerName={bowlerName}>
        <div className="text-center">League not found</div>
      </BowlerLayout>
    );
  }

  return (
    <BowlerLayout bowlerName={bowlerName} leagueName={league.name}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">League Rules</h1>
        <p className="text-muted-foreground mb-6">
          Rules and regulations for {league.name}
        </p>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>General Rules</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p>League rules and regulations will be displayed here.</p>
              <p className="text-muted-foreground">
                Please check with your league secretary for the complete set of rules and regulations.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </BowlerLayout>
  );
}
