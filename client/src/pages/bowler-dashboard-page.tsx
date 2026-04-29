import { useState, useEffect, FC, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, RefreshCw, AlertTriangle, Calendar, ChevronDown } from "lucide-react";
import { PageLoadingState } from "@/components/page-states";
import { LeagueBottomSheet } from "@/components/league-bottom-sheet";
import { Link } from "wouter";
import { BowlerLayout } from "@/components/bowler-layout";
import { getSeasonLengthWeeks, getWeeksPassedInSeason } from "@/lib/financial-utils";
import { DEFAULT_WEEKLY_FEE_CENTS } from "@shared/schema";
import type { League, Payment, User, Bowler, BowlerLeague, Team, ApiResponse } from "@shared/schema";
import { PaymentStatusSection } from "@/components/payment-status-section";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ErrorBoundary } from "@/components/error-boundary";
import { useSelectedLeague } from "@/hooks/use-selected-league";

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
  const [selectedLeagueId, setSelectedLeagueId] = useSelectedLeague();
  const [sheetOpen, setSheetOpen] = useState(false);

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

  const totalWeeksMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const bl of activeBowlerLeagues) {
      const l = leagueMap.get(bl.leagueId);
      if (l) map.set(bl.leagueId, getSeasonLengthWeeks(l) || 30);
    }
    return map;
  }, [activeBowlerLeagues, leagueMap]);

  const currentWeekMap = useMemo(() => {
    const map = new Map<number, number | null>();
    for (const bl of activeBowlerLeagues) {
      const l = leagueMap.get(bl.leagueId);
      if (!l?.seasonStart) {
        map.set(bl.leagueId, null);
      } else {
        const tw = totalWeeksMap.get(bl.leagueId) || 30;
        const wp = getWeeksPassedInSeason(l);
        map.set(bl.leagueId, Math.max(1, Math.min(wp + 1, tw)));
      }
    }
    return map;
  }, [activeBowlerLeagues, leagueMap, totalWeeksMap]);

  const weeklyFee = useMemo(() => {
    return league?.weeklyFee || DEFAULT_WEEKLY_FEE_CENTS;
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

  const handleRetry = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/user'] });
    queryClient.invalidateQueries({ queryKey: ['/api/bowlers'] });
    queryClient.invalidateQueries({ queryKey: ['/api/bowler-leagues'] });
    queryClient.invalidateQueries({ queryKey: ['/api/leagues'] });
    queryClient.invalidateQueries({ queryKey: ['/api/teams'] });
    queryClient.invalidateQueries({ queryKey: ['/api/payments'] });
  };

  const noBowlerProfile = !bowler && !isLoadingUser && !isLoadingBowlers && !userError && !bowlersError && !!currentUser;
  useEffect(() => {
    if (noBowlerProfile) {
      apiRequest('/api/auth/logout', 'POST', {})
        .catch(() => {})
        .finally(() => {
          queryClient.clear();
          window.location.href = '/login';
        });
    }
  }, [noBowlerProfile]);

  if (isStillLoadingChain && !league) {
    return <PageLoadingState message="Loading dashboard data..." />;
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
          <Button asChild className="w-full">
            <Link href="/login">Log In</Link>
          </Button>
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
    return <PageLoadingState />;
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
      currentLeagueId={activeBowlerLeague?.leagueId}
    >
      {isSystemAdmin && (
        <div className="mb-6">
          <Button asChild variant="outline" className="flex items-center gap-2">
            <Link href="/">
              <ArrowRight className="h-4 w-4 rotate-180" />
              Back to Dashboard
            </Link>
          </Button>
        </div>
      )}
      
      <ErrorBoundary level="section">
      <div className="space-y-6">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
          <h2 className="text-2xl font-bold text-slate-900 mb-1">Hi, {bowler.name}</h2>
          {isSystemAdmin && (
            <p className="text-sm text-slate-400 mb-1">Viewing as System Administrator</p>
          )}
          {hasMultipleLeagues ? (
            <button
              onClick={() => setSheetOpen(true)}
              className="flex items-center gap-1 text-slate-500 hover:text-slate-700 transition-colors"
            >
              <span>{leagueName}</span>
              <ChevronDown className="w-4 h-4" />
            </button>
          ) : (
            <p className="text-slate-500">{leagueName}</p>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <div className="inline-flex items-center px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-700 text-sm font-medium">
              <span className="w-2 h-2 rounded-full bg-indigo-500 mr-2"></span>
              {teamName}
            </div>
            {currentWeek !== null && (
              <div className="inline-flex items-center px-3 py-1.5 rounded-full bg-slate-100 text-slate-700 text-sm font-medium">
                <Calendar className="w-4 h-4 mr-1.5" />
                Week {currentWeek} of {totalWeeks}
              </div>
            )}
          </div>
        </div>

        <PaymentStatusSection
          key={league.id}
          league={league}
          bowler={bowler}
          weeklyFee={weeklyFee}
          totalWeeks={totalWeeks}
          payments={paymentsResponse?.data || []}
        />
      </div>
      </ErrorBoundary>

      <LeagueBottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        activeBowlerLeagues={activeBowlerLeagues}
        leagueMap={leagueMap}
        teamMap={teamMap}
        selectedLeagueId={activeBowlerLeague?.leagueId ?? null}
        onSelectLeague={(id) => setSelectedLeagueId(id)}
        totalWeeksMap={totalWeeksMap}
        currentWeekMap={currentWeekMap}
      />
    </BowlerLayout>
  );
};

export default BowlerDashboardPage;
