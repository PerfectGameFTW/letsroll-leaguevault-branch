import { useState, FC, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, RefreshCw, AlertTriangle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "wouter";
import { BowlerLayout } from "@/components/bowler-layout";
import { getSeasonLengthWeeks, getWeeksPassedInSeason } from "@/lib/financial-utils";
import type { League, Payment, User, Bowler, BowlerLeague, Team } from "@shared/schema";
import { PaymentStatusSection } from "@/components/payment-status-section";
import { queryClient } from "@/lib/queryClient";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    message: string;
    code?: string;
  };
}

const STALE_TIME = 1000 * 60 * 5;

function ErrorCard({ title, description, onRetry }: { title: string; description: string; onRetry?: () => void }) {
  return (
    <Card className="mx-auto max-w-md mt-8">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <CardTitle>{title}</CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {onRetry && (
        <CardContent>
          <Button variant="outline" onClick={onRetry} className="w-full flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Try Again
          </Button>
        </CardContent>
      )}
    </Card>
  );
}

export const BowlerDashboardPage: FC = () => {
  const [selectedLeagueId, setSelectedLeagueId] = useState<number | null>(null);

  const { data: userResponse, isLoading: isLoadingUser, error: userError } = useQuery<{ success: boolean; data: User }>({
    queryKey: ['/api/user'],
    staleTime: STALE_TIME,
  });
  const currentUser = userResponse?.data;

  const { data: bowlersResponse, isLoading: isLoadingBowlers, error: bowlersError } = useQuery<ApiResponse<Bowler[]>>({
    queryKey: ['/api/bowlers'],
    enabled: !!currentUser?.bowlerId,
    staleTime: 0,
  });

  const bowler = useMemo(() => {
    if (!currentUser?.bowlerId || !bowlersResponse?.data) return null;
    const found = bowlersResponse.data.find(b => b.id === currentUser.bowlerId);
    return found ?? null;
  }, [bowlersResponse?.data, currentUser?.bowlerId]);

  const { data: bowlerLeaguesResponse, isLoading: isLoadingBL, error: blError } = useQuery<ApiResponse<BowlerLeague[]>>({
    queryKey: ['/api/bowler-leagues'],
    enabled: !!bowler,
    staleTime: STALE_TIME,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
  });

  const activeBowlerLeagues = useMemo((): BowlerLeague[] => {
    if (!bowler || !bowlerLeaguesResponse?.data) return [];
    return bowlerLeaguesResponse.data.filter(bl => bl.bowlerId === bowler.id && bl.active);
  }, [bowlerLeaguesResponse?.data, bowler]);

  const activeBowlerLeague = useMemo((): BowlerLeague | null => {
    if (activeBowlerLeagues.length === 0) return null;
    if (selectedLeagueId) {
      return activeBowlerLeagues.find(bl => bl.leagueId === selectedLeagueId) ?? activeBowlerLeagues[0];
    }
    return activeBowlerLeagues[0];
  }, [activeBowlerLeagues, selectedLeagueId]);

  const { data: leaguesResponse, isLoading: isLoadingLeagues, isFetching: isFetchingLeagues, error: leaguesError } = useQuery<ApiResponse<League[]>>({
    queryKey: ['/api/leagues'],
    enabled: activeBowlerLeagues.length > 0,
    staleTime: 0,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
  });

  const leagueMap = useMemo(() => {
    const map = new Map<number, League>();
    if (leaguesResponse?.data) {
      for (const l of leaguesResponse.data) {
        map.set(l.id, l);
      }
    }
    return map;
  }, [leaguesResponse?.data]);

  const league = activeBowlerLeague ? leagueMap.get(activeBowlerLeague.leagueId) : undefined;

  const { data: teamsResponse, isLoading: isLoadingTeams, error: teamsError } = useQuery<ApiResponse<Team[]>>({
    queryKey: ['/api/teams'],
    enabled: activeBowlerLeagues.length > 0,
    staleTime: 0,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
  });

  const teamMap = useMemo(() => {
    const map = new Map<number, Team>();
    if (teamsResponse?.data) {
      for (const t of teamsResponse.data) {
        map.set(t.id, t);
      }
    }
    return map;
  }, [teamsResponse?.data]);

  const team = activeBowlerLeague?.teamId ? teamMap.get(activeBowlerLeague.teamId) : undefined;

  const leagueName = league?.name ?? "No League";
  const teamName = team?.name ?? "No Team";

  const totalWeeks = useMemo(() => {
    return getSeasonLengthWeeks(league) || 30;
  }, [league]);

  const currentWeek = useMemo(() => {
    if (!league?.seasonStart) return null;
    const weeksPassed = getWeeksPassedInSeason(league);
    return Math.max(1, Math.min(weeksPassed + 1, totalWeeks));
  }, [league, totalWeeks]);

  const weeklyFee = useMemo(() => {
    return league?.weeklyFee || 2000;
  }, [league]);

  const { data: paymentsResponse, isLoading: isLoadingPayments } = useQuery<ApiResponse<Payment[]>>({
    queryKey: ['/api/payments', bowler?.id],
    enabled: !!bowler?.id,
    staleTime: STALE_TIME,
  });

  const leagueNotYetResolved = activeBowlerLeagues.length > 0 && !leagueMap.has(activeBowlerLeagues[0].leagueId);

  const isStillLoadingChain =
    isLoadingUser ||
    isLoadingBowlers ||
    isLoadingBL ||
    isLoadingLeagues ||
    isLoadingTeams ||
    isLoadingPayments ||
    (!!currentUser?.bowlerId && !bowlersResponse) ||
    (!!bowler && !bowlerLeaguesResponse) ||
    (activeBowlerLeagues.length > 0 && !leaguesResponse) ||
    (activeBowlerLeagues.length > 0 && !teamsResponse) ||
    (leagueNotYetResolved && isFetchingLeagues);

  const hasError = userError || bowlersError || blError || leaguesError || teamsError;

  const handleRetry = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/user'] });
    queryClient.invalidateQueries({ queryKey: ['/api/bowlers'] });
    queryClient.invalidateQueries({ queryKey: ['/api/bowler-leagues'] });
    queryClient.invalidateQueries({ queryKey: ['/api/leagues'] });
    queryClient.invalidateQueries({ queryKey: ['/api/teams'] });
    queryClient.invalidateQueries({ queryKey: ['/api/payments'] });
  };

  if (isStillLoadingChain && !league) {
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

  if (userError) {
    return (
      <ErrorCard
        title="Authentication Error"
        description="We couldn't verify your login session. Please try again or log in again."
        onRetry={handleRetry}
      />
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

  if (bowlersError) {
    return (
      <ErrorCard
        title="Failed to Load Bowler Profile"
        description="We couldn't load your bowler information. This may be a temporary issue."
        onRetry={handleRetry}
      />
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

  if (blError || leaguesError || teamsError) {
    return (
      <ErrorCard
        title="Failed to Load League Data"
        description="We found your profile but couldn't load your league information. Please try again."
        onRetry={handleRetry}
      />
    );
  }

  if (!league) {
    return (
      <Card className="mx-auto max-w-md mt-8">
        <CardHeader>
          <CardTitle>League Data Unavailable</CardTitle>
          <CardDescription>Unable to load league information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            Please try again later or contact support if the problem persists.
          </p>
          <Button variant="outline" onClick={handleRetry} className="w-full flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const isSystemAdmin = currentUser?.role === 'system_admin';
  const hasMultipleLeagues = activeBowlerLeagues.length > 1;

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
            <div className="space-y-2">
              {hasMultipleLeagues ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Active League</label>
                  <Select
                    value={String(activeBowlerLeague?.leagueId ?? activeBowlerLeagues[0]?.leagueId)}
                    onValueChange={(val) => setSelectedLeagueId(Number(val))}
                  >
                    <SelectTrigger className="w-full md:w-72">
                      <SelectValue placeholder="Select a league" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeBowlerLeagues.map(bl => {
                        const l = leagueMap.get(bl.leagueId);
                        return (
                          <SelectItem key={bl.leagueId} value={String(bl.leagueId)}>
                            {l?.name ?? `League #${bl.leagueId}`}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <p className="text-base text-muted-foreground">{teamName}</p>
                  {currentWeek !== null && (
                    <p className="text-sm text-muted-foreground">Week {currentWeek} of {totalWeeks}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-0.5">
                  <p className="text-lg">{leagueName}</p>
                  <p className="text-base text-muted-foreground">{teamName}</p>
                  {currentWeek !== null && (
                    <p className="text-sm text-muted-foreground">Week {currentWeek} of {totalWeeks}</p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <PaymentStatusSection
          league={league}
          bowler={bowler}
          weeklyFee={weeklyFee}
          totalWeeks={totalWeeks}
          payments={paymentsResponse?.data || []}
        />
      </div>
    </BowlerLayout>
  );
};

export default BowlerDashboardPage;
