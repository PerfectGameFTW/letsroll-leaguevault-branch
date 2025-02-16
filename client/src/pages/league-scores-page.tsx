import { useState, useMemo } from "react";
import { useParams, Link } from "wouter";
import { Layout } from "@/components/layout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, ArrowLeft, AlertCircle } from "lucide-react";
import type { Game, League, ApiResponse } from "@shared/schema";
import type { WeeklyScores, BowlerScores, TeamScores } from "@/lib/types/scores";
import { cn } from "@/lib/utils";
import { groupTeamsByLanes } from "@/lib/utils/lane-pairing";
import { organizeBowlerScores, calculateSeriesTotal } from "@/lib/utils/score-organization";
import { useQuery } from "@tanstack/react-query";
import { LEAGUE_CACHE_TIME } from "@/lib/constants";


// Enhance the loading skeleton component with more realistic loading states
function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-32 bg-muted animate-pulse rounded" />
      <div className="space-y-2">
        <div className="h-8 w-64 bg-muted animate-pulse rounded" />
        <div className="h-4 w-96 bg-muted animate-pulse rounded" />
      </div>
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader className="pb-2">
              <div className="h-6 w-32 bg-muted rounded" />
            </CardHeader>
            <CardContent>
              <div className="space-y-8">
                {[...Array(2)].map((_, j) => (
                  <div key={j} className="space-y-4">
                    <div className="h-6 w-48 bg-muted rounded" />
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {[...Array(6)].map((_, k) => (
                            <TableHead key={k}>
                              <div className="h-4 w-full bg-muted rounded" />
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[...Array(4)].map((_, l) => (
                          <TableRow key={l}>
                            {[...Array(6)].map((_, m) => (
                              <TableCell key={m}>
                                <div className="h-4 w-full bg-muted rounded" />
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

interface ErrorDisplayProps {
  errors: Array<{ type: string; error: unknown }>;
}

function ErrorDisplay({ errors }: ErrorDisplayProps) {
  return (
    <div className="space-y-4">
      {errors.map(({ type, error }) => (
        <div key={type} className="p-4 rounded-md bg-destructive/10 text-destructive flex items-center gap-2">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <p className="font-medium">
            Error loading {type}: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function LeagueScoresPage() {
  const params = useParams();
  const leagueId = params.leagueId ? parseInt(params.leagueId) : undefined;
  const [selectedWeek, setSelectedWeek] = useState<number | undefined>();

  // Early return for invalid league ID
  if (!leagueId) {
    console.error('[LeagueScoresPage] Invalid league ID provided');
    return (
      <Layout>
        <div className="flex items-center gap-2 p-4 rounded-md bg-destructive/10 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <p>Invalid league ID provided</p>
        </div>
      </Layout>
    );
  }

  // Fetch league details with longer cache time since they rarely change
  const { data: leagueResponse, isLoading: loadingLeague, error: leagueError } = useQuery({
    queryKey: ['/api/leagues', leagueId] as const,
    queryFn: async () => {
      console.log('[useLeagueScores] Fetching league details:', leagueId);
      try {
        const response = await fetch(`/api/leagues/${leagueId}`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
          throw new Error(errorData.message || `Failed to fetch league (${response.status})`);
        }
        const data = await response.json() as ApiResponse<League>;
        console.log('[useLeagueScores] Received league:', data.data?.name);
        return data;
      } catch (error) {
        console.error('[useLeagueScores] Error fetching league:', error);
        throw error;
      }
    },
    enabled: !!leagueId,
    gcTime: LEAGUE_CACHE_TIME * 2,
    staleTime: LEAGUE_CACHE_TIME,
  });

  const { data: scoresResponse, isLoading, errors } = useQuery({
    queryKey: [`/api/scores`, leagueId, selectedWeek] as const,
    queryFn: async () => {
      const url = `/api/scores?leagueId=${leagueId}&weekNumber=${selectedWeek}`;
      console.log('[useLeagueScores] Fetching scores:', url);
      const response = await fetch(url);
      if (!response.ok) {
          throw new Error(`Failed to fetch scores (${response.status})`);
      }
      const data = await response.json() as ApiResponse<Game[]>;
      console.log('[useLeagueScores] Received scores:', data.data?.length);
      return data.data;
    },
    enabled: !!leagueId && !!selectedWeek
  });

  const league = leagueResponse?.data;
  const weeks = league?.weeks || [];
  const scores = scoresResponse || [];


  // Log data for debugging
  console.log('[LeagueScoresPage] Data state:', {
    leagueId,
    selectedWeek,
    weeksAvailable: weeks.length,
    scoresReceived: scores.length,
    isLoading,
    hasErrors: errors.length > 0,
    errorDetails: errors.length > 0 ? errors : undefined,
    loadingLeague,
    leagueError
  });

  // Set initial week when data loads
  useMemo(() => {
    if (selectedWeek === undefined && weeks.length > 0) {
      console.log('[LeagueScoresPage] Setting initial week:', weeks[0]);
      setSelectedWeek(weeks[0]);
    }
  }, [weeks, selectedWeek]);

  // Week selection section
  const weekSelector = (
    <Select
      value={selectedWeek?.toString()}
      onValueChange={(value: string) => setSelectedWeek(parseInt(value))}
    >
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Select week" />
      </SelectTrigger>
      <SelectContent>
        {weeks.map((week: number) => (
          <SelectItem key={week} value={week.toString()}>
            Week {week}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  // Memoize score organization to prevent unnecessary recalculations
  const weeklyScores = useMemo(() => {
    if (scores.length > 0) {
      console.log('[LeagueScoresPage] Organizing scores for week:', selectedWeek);
      return organizeBowlerScores(scores);
    }
    console.log('[LeagueScoresPage] No scores to organize');
    return null;
  }, [scores, selectedWeek]);

  // Memoize lane pairs to prevent unnecessary recalculations
  const lanePairs = useMemo(() => {
    if (weeklyScores?.teams) {
      console.log('[LeagueScoresPage] Grouping teams by lanes:', {
        teamCount: weeklyScores.teams.length,
        weekNumber: weeklyScores.weekNumber
      });
      return groupTeamsByLanes(weeklyScores.teams);
    }
    console.log('[LeagueScoresPage] No teams to group into lanes');
    return [];
  }, [weeklyScores]);

  if (loadingLeague || isLoading) {
    return (
      <Layout>
        <div className="space-y-4">
          <Link
            href={`/leagues/${leagueId}`}
            className="text-muted-foreground hover:text-foreground flex items-center"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to League
          </Link>
          <LoadingSkeleton />
        </div>
      </Layout>
    );
  }

  if (leagueError || errors.length > 0) {
    const allErrors = [...(leagueError ? [ {type: "League", error: leagueError} ] : []), ...errors];
    return (
      <Layout>
        <div className="space-y-4">
          <Link
            href={`/leagues/${leagueId}`}
            className="text-muted-foreground hover:text-foreground flex items-center mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to League
          </Link>
          <ErrorDisplay errors={allErrors} />
        </div>
      </Layout>
    );
  }

  if (!league) {
    return (
      <Layout>
        <div className="space-y-4">
          <Link
            href="/leagues"
            className="text-muted-foreground hover:text-foreground flex items-center mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Leagues
          </Link>
          <div className="flex items-center gap-2 p-4 rounded-md bg-destructive/10 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p>League not found</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <TooltipProvider>
        <div className="space-y-6">
          <Link
            href={`/leagues/${leagueId}`}
            className="text-muted-foreground hover:text-foreground flex items-center"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to League
          </Link>

          <div>
            <h1 className="text-2xl font-bold mb-2">{league.name} Scores</h1>
            <p className="text-muted-foreground mb-6">
              View weekly scores and matchups for all teams
            </p>
          </div>

          <div className="flex items-center gap-4 mb-6">
            {weekSelector}
            {selectedWeek && (
              <p className="text-sm text-muted-foreground">
                Showing scores for Week {selectedWeek}
              </p>
            )}
          </div>

          {weeklyScores ? (
            <div className="grid gap-6">
              {lanePairs.map((pair, pairIndex) => (
                <Card key={pairIndex} className="hover:border-primary/50 transition-colors">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg font-semibold text-primary">
                      {pair.lanes}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-8">
                      {[pair.homeTeam, pair.awayTeam].map((team, teamIndex) => (
                        team && (
                          <div key={team.teamId} className="space-y-2">
                            <h4 className="font-medium">{team.teamName}</h4>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-[200px]">Bowler</TableHead>
                                  <TableHead className="text-right">Handicap</TableHead>
                                  <TableHead className="text-right">Game 1</TableHead>
                                  <TableHead className="text-right">Game 2</TableHead>
                                  <TableHead className="text-right">Game 3</TableHead>
                                  <TableHead className="text-right">Series</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {team.bowlers.map((bowler: BowlerScores) => {
                                  const seriesTotal = useMemo(() =>
                                    calculateSeriesTotal(bowler.games),
                                    [bowler.games]
                                  );

                                  return (
                                    <TableRow key={bowler.bowlerId}>
                                      <TableCell>
                                        {bowler.isVacant ? (
                                          <span className="text-muted-foreground italic">Vacant</span>
                                        ) : bowler.isAbsent ? (
                                          <span className="text-muted-foreground italic">Absent</span>
                                        ) : (
                                          <div className="flex items-center gap-2">
                                            <Link
                                              href={`/bowlers/${bowler.bowlerId}`}
                                              className="hover:underline"
                                            >
                                              {bowler.bowlerName}
                                            </Link>
                                            {bowler.isSub && (
                                              <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                                                Sub
                                              </span>
                                            )}
                                          </div>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-right text-muted-foreground">
                                        {bowler.handicap ?? "—"}
                                      </TableCell>
                                      {bowler.games.map((game: { gameNumber: number; score: number | null }) => (
                                        <TableCell
                                          key={game.gameNumber}
                                          className={cn(
                                            "text-right font-medium",
                                            game.score !== null && [
                                              game.score >= 250 && "text-green-600",
                                              game.score >= 200 && game.score < 250 && "text-primary"
                                            ]
                                          )}
                                        >
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <span>{game.score ?? "—"}</span>
                                            </TooltipTrigger>
                                            {game.score !== null && game.score >= 200 && (
                                              <TooltipContent>
                                                {game.score >= 250 ? "Perfect game approaching!" : "Great game!"}
                                              </TooltipContent>
                                            )}
                                          </Tooltip>
                                        </TableCell>
                                      ))}
                                      <TableCell className="text-right font-medium">
                                        {seriesTotal || "—"}
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        )
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center p-8 border rounded-lg bg-background">
              <p className="text-lg text-muted-foreground">No games have been recorded for this league yet</p>
              <p className="text-sm text-muted-foreground mt-2">Scores will appear here once games are imported</p>
            </div>
          )}
        </div>
      </TooltipProvider>
    </Layout>
  );
}