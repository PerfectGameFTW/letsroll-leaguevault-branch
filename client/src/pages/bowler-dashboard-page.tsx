import { FC } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBowlers } from "@/hooks/use-bowlers";
import { useQuery } from "@tanstack/react-query";
import type { User } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

const BowlerDashboardPage: FC = () => {
  const { toast } = useToast();
  const { data: currentUser, error: userError, isLoading: isUserLoading } = useQuery<{ success: true; data: User }>({
    queryKey: ["/api/user"],
    onError: (error) => {
      console.error("[BowlerDashboard] Error fetching user data:", error);
      toast({
        title: "Error",
        description: "Failed to load user data. Please try again later.",
        variant: "destructive",
      });
    },
  });

  const { 
    bowlers, 
    getBowlerTeamName, 
    getBowlerFirstLeagueName, 
    isInitialLoading, 
    isLoadingRelatedData,
    error: bowlersError
  } = useBowlers();

  console.log("[BowlerDashboard] Current user:", currentUser?.data);
  const bowler = currentUser?.data?.bowlerId ? bowlers.find(b => b.id === currentUser.data.bowlerId) : null;
  console.log("[BowlerDashboard] Found bowler:", bowler);

  if (isUserLoading || isInitialLoading || isLoadingRelatedData) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="animate-pulse bg-muted h-8 w-1/3 rounded" />
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="animate-pulse bg-muted h-6 w-1/2 rounded" />
            <div className="animate-pulse bg-muted h-6 w-1/4 rounded" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (userError || bowlersError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Error Loading Dashboard</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-destructive">
            {userError ? "Failed to load user data" : "Failed to load bowler data"}. Please try again later.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!currentUser?.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Authentication Required</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Please log in to view your dashboard.</p>
        </CardContent>
      </Card>
    );
  }

  if (!bowler) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Profile Setup Required</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Your bowler profile has not been set up yet. Please contact a league administrator.</p>
        </CardContent>
      </Card>
    );
  }

  const teamName = getBowlerTeamName(bowler);
  const leagueName = getBowlerFirstLeagueName(bowler);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{bowler.name}'s Dashboard</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p><span className="font-medium">League:</span> {leagueName || "Not assigned to a league"}</p>
          <p><span className="font-medium">Team:</span> {teamName || "Not assigned to a team"}</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default BowlerDashboardPage;