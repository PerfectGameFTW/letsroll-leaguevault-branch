import { useCallback, FC, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { BowlerLayout } from "@/components/bowler-layout";
import { getSeasonLengthWeeks } from "@/lib/financial-utils";
import type { League, Payment, User, Bowler, BowlerLeague, Team } from "@shared/schema";
import { PaymentStatusSection } from "@/components/payment-status-section";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    message: string;
    code?: string;
  };
}

export const BowlerDashboardPage: FC = () => {
  const { data: userResponse, isLoading: isLoadingUser } = useQuery<{ success: boolean; data: User }>({
    queryKey: ['/api/user'],
  });
  const currentUser = userResponse?.data;

  const { data: bowlersResponse, isLoading: isLoadingBowlers } = useQuery<ApiResponse<Bowler[]>>({
    queryKey: ['/api/bowlers'],
    enabled: !!currentUser?.bowlerId,
  });

  const bowler = useMemo(() => {
    if (!currentUser?.bowlerId || !bowlersResponse?.data) return null;
    return bowlersResponse.data.find(b => b.id === currentUser.bowlerId) || null;
  }, [bowlersResponse?.data, currentUser?.bowlerId]);

  const { data: bowlerLeaguesResponse, isLoading: isLoadingBL } = useQuery<ApiResponse<BowlerLeague[]>>({
    queryKey: ['/api/bowler-leagues'],
    enabled: !!bowler,
  });

  const activeBowlerLeague = useMemo(() => {
    if (!bowler || !bowlerLeaguesResponse?.data) return null;
    return bowlerLeaguesResponse.data.find(bl => bl.bowlerId === bowler.id && bl.active) || null;
  }, [bowlerLeaguesResponse?.data, bowler]);

  const { data: leaguesResponse, isLoading: isLoadingLeagues } = useQuery<ApiResponse<League[]>>({
    queryKey: ['/api/leagues'],
    enabled: !!activeBowlerLeague,
  });

  const league = useMemo(() => {
    if (!activeBowlerLeague || !leaguesResponse?.data) return undefined;
    return leaguesResponse.data.find(l => l.id === activeBowlerLeague.leagueId);
  }, [leaguesResponse?.data, activeBowlerLeague]);

  const { data: teamsResponse, isLoading: isLoadingTeams } = useQuery<ApiResponse<Team[]>>({
    queryKey: ['/api/teams'],
    enabled: !!activeBowlerLeague,
  });

  const team = useMemo(() => {
    if (!activeBowlerLeague || !teamsResponse?.data) return undefined;
    return teamsResponse.data.find(t => t.id === activeBowlerLeague.teamId);
  }, [teamsResponse?.data, activeBowlerLeague]);

  const leagueName = league?.name || "No League";
  const teamName = team?.name || "No Team";

  const totalWeeks = useMemo(() => {
    return getSeasonLengthWeeks(league) || 30;
  }, [league]);

  const weeklyFee = useMemo(() => {
    return league?.weeklyFee || 2000;
  }, [league]);

  const { data: paymentsResponse, isLoading: isLoadingPayments } = useQuery<ApiResponse<Payment[]>>({
    queryKey: ['/api/payments', bowler?.id],
    enabled: !!bowler?.id,
  });

  const isLoading = isLoadingUser || isLoadingBowlers || isLoadingBL || isLoadingLeagues || isLoadingTeams || isLoadingPayments;

  if (isLoading && !league) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <div className="text-center">
          <h3 className="text-lg font-medium">Loading dashboard data...</h3>
          <p className="text-sm text-muted-foreground mt-1">Please wait while we retrieve your information.</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <Card className="mx-auto max-w-md mt-8">
        <CardHeader>
          <CardTitle>Authentication Required</CardTitle>
          <CardDescription>Please log in to view your dashboard</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            You need to be logged in to access your bowler dashboard.
          </p>
          <Link href="/login">
            <Button className="w-full">Log In</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (!bowler) {
    return (
      <Card className="mx-auto max-w-md mt-8">
        <CardHeader>
          <CardTitle>Profile Setup Required</CardTitle>
          <CardDescription>Your bowler profile needs to be configured</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Please contact a league administrator to set up your bowler profile.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!league) {
    return (
      <Card className="mx-auto max-w-md mt-8">
        <CardHeader>
          <CardTitle>League Data Unavailable</CardTitle>
          <CardDescription>Unable to load league information</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Please try again later or contact support if the problem persists.
          </p>
        </CardContent>
      </Card>
    );
  }

  const isSystemAdmin = currentUser?.isAdmin && currentUser?.isOrganizationAdmin;

  return (
    <BowlerLayout
      bowlerName={bowler.name}
      leagueName={leagueName}
    >
      {isSystemAdmin && (
        <div className="mb-6">
          <Link href="/">
            <Button variant="outline" className="flex items-center gap-2">
              <ArrowRight className="h-4 w-4 rotate-180" />
              Back to Dashboard
            </Button>
          </Link>
        </div>
      )}
      
      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-3xl font-bold">{bowler.name}</CardTitle>
            {isSystemAdmin && (
              <p className="text-sm text-muted-foreground mt-1">
                You are viewing this account as a System Administrator
              </p>
            )}
          </CardHeader>
          <CardContent>
            <div className="space-y-0.5">
              <p className="text-lg">{leagueName}</p>
              <p className="text-base text-muted-foreground">{teamName}</p>
            </div>
          </CardContent>
        </Card>

        <PaymentStatusSection
          league={league}
          bowler={bowler}
          weeklyFee={weeklyFee}
          totalWeeks={totalWeeks}
        />
      </div>
    </BowlerLayout>
  );
};

export default BowlerDashboardPage;
