import { FC } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBowlers } from "@/hooks/use-bowlers";
import { useQuery } from "@tanstack/react-query";
import type { User } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Trophy, CreditCard, Gift } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

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
    error: bowlersError,
    getBowlerLeagueId
  } = useBowlers();

  // Add loyalty points query
  const { data: loyaltyInfo, isLoading: isLoyaltyLoading } = useQuery({
    queryKey: ["/api/square/loyalty", currentUser?.data?.bowlerId],
    enabled: !!currentUser?.data?.bowlerId,
  });

  console.log("[BowlerDashboard] Current user:", currentUser?.data);
  const bowler = currentUser?.data?.bowlerId ? bowlers.find(b => b.id === currentUser.data.bowlerId) : null;
  console.log("[BowlerDashboard] Found bowler:", bowler);

  if (isUserLoading || isInitialLoading || isLoadingRelatedData || isLoyaltyLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{bowler.name}'s Dashboard</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* League Information Section */}
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <div className="md:col-span-3">
              <h3 className="text-lg font-semibold mb-4">League Information</h3>
              <div className="rounded-lg border p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Current League</p>
                    <p className="text-lg font-semibold">{leagueName || "Not Assigned"}</p>
                  </div>
                  <Trophy className="h-8 w-8 text-primary opacity-50" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Team</p>
                  <p className="text-lg font-semibold">{teamName || "Not Assigned"}</p>
                </div>
              </div>
            </div>
            <div className="md:col-span-3">
              <h3 className="text-lg font-semibold mb-4 opacity-0">Actions</h3>
              <div className="rounded-lg border">
                <Link href={`/bowlers/${bowler.id}/scores`} className="block">
                  <Card className="cursor-pointer hover:bg-accent transition-colors">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <Trophy className="h-5 w-5 text-primary opacity-75" />
                        View Scores
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground mb-4">
                        Track your performance and view historical scores
                      </p>
                      <Button variant="secondary" className="w-full">
                        View Scores
                      </Button>
                    </CardContent>
                  </Card>
                </Link>
              </div>
            </div>
          </div>

          {/* Quick Action Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link href="/payments">
              <Card className="cursor-pointer hover:bg-accent transition-colors">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <CreditCard className="h-5 w-5 text-primary opacity-75" />
                    Payment History
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    View and manage your league payments
                  </p>
                  <Button variant="secondary" className="w-full">View Payments</Button>
                </CardContent>
              </Card>
            </Link>
            <Card className="cursor-pointer hover:bg-accent transition-colors">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Gift className="h-5 w-5 text-primary opacity-75" />
                  Loyalty Program
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoyaltyLoading ? (
                  <div className="flex items-center justify-center p-4">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </div>
                ) : loyaltyInfo ? (
                  <div className="space-y-2 mb-4">
                    <p className="text-sm text-muted-foreground">Current Points</p>
                    <p className="text-2xl font-bold">{loyaltyInfo.points}</p>
                    <p className="text-sm text-muted-foreground">Loyalty Status: {loyaltyInfo.status}</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground mb-4">
                    Join our loyalty program to earn rewards
                  </p>
                )}
                <Button variant="secondary" className="w-full">
                  {loyaltyInfo ? "View Rewards" : "Enroll Now"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default BowlerDashboardPage;