import { useState, useCallback, FC, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { BowlerLayout } from "@/components/bowler-layout";
import { getSeasonLengthWeeks } from "@/lib/financial-utils";
import type { League, Payment, User, Bowler as SchemaBowler } from "@shared/schema";
import { useBowlers } from "@/hooks/use-bowlers";
import { PaymentStatusSection } from "@/components/payment-status-section";

interface Bowler extends SchemaBowler {
  leagues?: {
    leagueId: number;
    leagueName: string;
    teamId: number;
    teamName: string;
  }[];
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    message: string;
    code?: string;
  };
}

export const BowlerDashboardPage: FC = () => {
  const { data: userResponse } = useQuery<{ success: boolean; data: User }>({
    queryKey: ['/api/user'],
    enabled: true,
  });

  const currentUser = userResponse?.data;
  const { 
    bowlers, 
    isInitialLoading: isLoadingBowlers, 
    isLoadingRelatedData: isLoadingRelated,
    getBowlerFirstLeagueName, 
    getBowlerTeamName, 
    getBowlerLeagueId 
  } = useBowlers();
  
  const bowler = useMemo(() => {
    return currentUser?.bowlerId ? bowlers.find((b: Bowler) => b.id === currentUser.bowlerId) : null;
  }, [bowlers, currentUser]);

  const getLeagueId = useCallback((bowler: Bowler) => {
    if (bowler?.leagues && bowler.leagues.length > 0) {
      return bowler.leagues[0].leagueId;
    }
    return getBowlerLeagueId ? getBowlerLeagueId(bowler) : undefined;
  }, [getBowlerLeagueId]);
  
  const leagueId = bowler ? getLeagueId(bowler) : undefined;
              
  const { data: leagueResponse, isLoading: isLoadingLeague } = useQuery<{ success: boolean; data: League | League[] }>({
    queryKey: leagueId ? ['/api/leagues', leagueId] : ['/api/leagues'],
    enabled: true,
  });

  const league = useMemo(() => {
    if (!leagueResponse?.data) {
      return undefined;
    }
    
    if ('id' in leagueResponse.data) {
      return leagueResponse.data as League;
    }
    
    if (Array.isArray(leagueResponse.data)) {
      if (leagueId) {
        return leagueResponse.data.find(l => l.id === leagueId);
      } else if (leagueResponse.data.length > 0) {
        return leagueResponse.data[0];
      }
    }
    
    return undefined;
  }, [leagueResponse, leagueId]);
  
  const totalWeeks = useMemo(() => {
    const weeks = getSeasonLengthWeeks(league);
    return weeks || 30;
  }, [league]);
  
  const weeklyFee = useMemo(() => {
    return league?.weeklyFee || 2000;
  }, [league]);

  const { data: paymentsResponse, isLoading: isLoadingPayments } = useQuery<ApiResponse<Payment[]>>({
    queryKey: ['/api/payments', bowler?.id],
    enabled: !!bowler?.id,
  });

  const isLoadingRelatedData = isLoadingBowlers || isLoadingRelated || isLoadingLeague || isLoadingPayments;
  const isInitialLoading = !userResponse;
  const isCombinedLoading = isInitialLoading || isLoadingRelatedData;

  if (isInitialLoading || isLoadingRelatedData || isCombinedLoading) {
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
      leagueName={getBowlerFirstLeagueName(bowler)}
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
              <p className="text-lg">{getBowlerFirstLeagueName(bowler)}</p>
              <p className="text-base text-muted-foreground">{getBowlerTeamName(bowler)}</p>
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
