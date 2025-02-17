import { FC } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBowlers } from "@/hooks/use-bowlers";
import { useQuery } from "@tanstack/react-query";
import type { User } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h3 className="text-lg font-semibold mb-2">Profile Information</h3>
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Name</TableCell>
                    <TableCell>{bowler.name}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Email</TableCell>
                    <TableCell>{bowler.email}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">League</TableCell>
                    <TableCell>{leagueName || "Not assigned to a league"}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Team</TableCell>
                    <TableCell>{teamName || "Not assigned to a team"}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Status</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${bowler.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                        {bowler.active ? 'Active' : 'Inactive'}
                      </span>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-2">Recent Activity</h3>
              <div className="bg-muted/50 rounded-lg p-4">
                <p className="text-sm text-muted-foreground">
                  Recent activity and statistics will be displayed here in future updates.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">View Scores</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Track your performance and view historical scores
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Payment History</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  View and manage your league payments
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">League Schedule</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Check upcoming games and events
                </p>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default BowlerDashboardPage;