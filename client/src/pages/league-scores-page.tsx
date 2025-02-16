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
import type { WeeklyScores } from "@/lib/types/scores";
import { cn } from "@/lib/utils";
import { useLeagueScores } from "@/hooks/use-league-scores";

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

export default function LeagueScoresPage() {
  const params = useParams();
  const leagueId = params.leagueId ? parseInt(params.leagueId) : undefined;
  const [selectedWeek, setSelectedWeek] = useState<number | undefined>();

  // Early return for invalid league ID
  if (!leagueId || isNaN(leagueId)) {
    return (
      <Layout>
        <div className="flex items-center gap-2 p-4 rounded-md bg-destructive/10 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <p>Invalid league ID provided</p>
        </div>
      </Layout>
    );
  }

  const {
    league,
    weeks,
    scores: weeklyScores,
    isLoading,
    errors,
  } = useLeagueScores({
    leagueId,
    weekNumber: selectedWeek,
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

  // Process scores and organize them by lanes
  const lanePairs = useMemo(() => {
    if (!weeklyScores?.teams) {
      console.log('[LeagueScoresPage] No teams data available');
      return [];
    }

    const pairs: Array<{
      lanes: string;
      homeTeam: typeof weeklyScores.teams[0];
      awayTeam: typeof weeklyScores.teams[0] | null;
    }> = [];

    for (let i = 0; i < weeklyScores.teams.length; i += 2) {
      const homeTeam = weeklyScores.teams[i];
      const awayTeam = i + 1 < weeklyScores.teams.length ? weeklyScores.teams[i + 1] : null;

      if (homeTeam) {
        const lanes = awayTeam 
          ? `Lanes ${homeTeam.laneNumber}-${awayTeam.laneNumber}` 
          : `Lane ${homeTeam.laneNumber}`;

        pairs.push({
          lanes,
          homeTeam,
          awayTeam,
        });
      }
    }

    console.log('[LeagueScoresPage] Processed lane pairs:', pairs.length);
    return pairs;
  }, [weeklyScores]);

  if (isLoading) {
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

  if (errors.length > 0) {
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
          <div className="p-4 rounded-md bg-destructive/10 text-destructive flex items-center gap-2">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <div>
              {errors.map((error, index) => (
                <p key={index}>
                  {error.type === 'league' && 'Error loading league data: '}
                  {error.type === 'games' && 'Error loading games: '}
                  {error.type === 'scores' && 'Error loading scores: '}
                  {error.error instanceof Error ? error.error.message : 'Unknown error'}
                </p>
              ))}
            </div>
          </div>
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
                                {team.bowlers.sort((a, b) => a.position - b.position).map((bowler) => {
                                  const seriesTotal = bowler.games
                                    .filter(game => game && game.score !== null)
                                    .reduce((sum, game) => sum + (game.score || 0), 0);

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
                                        {bowler.handicap}
                                      </TableCell>
                                      {bowler.games.map((game, gameIndex) => (
                                        <TableCell
                                          key={gameIndex}
                                          className={cn(
                                            "text-right",
                                            game?.score !== null && [
                                              game.score >= 250 && "text-green-600",
                                              game.score >= 200 && game.score < 250 && "text-primary"
                                            ]
                                          )}
                                        >
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <span>{game?.score ?? "—"}</span>
                                            </TooltipTrigger>
                                            {game?.score !== null && game.score >= 200 && (
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
              <p className="text-lg text-muted-foreground">
                No scores found for this week
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Try selecting a different week
              </p>
            </div>
          )}
        </div>
      </TooltipProvider>
    </Layout>
  );
}