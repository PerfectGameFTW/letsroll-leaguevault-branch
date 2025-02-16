import { useState, useMemo, useEffect as ReactuseEffect } from "react";
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
import { groupTeamsByLanes } from "@/lib/utils/lane-pairing";
import { organizeBowlerScores } from "@/lib/utils/score-organization";
import { useLeagueScores } from "@/hooks/use-league-scores";

// Loading skeleton component
function LoadingState() {
  return (
    <div className="flex items-center justify-center h-[50vh]">
      <div className="flex items-center gap-2">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="text-muted-foreground">Loading scores...</span>
      </div>
    </div>
  );
}

function ErrorDisplay({ errors }: { errors: Array<{ type: string; error: unknown }> }) {
  return (
    <div className="space-y-4">
      {errors.map(({ type, error }) => (
        <div key={type} className="p-4 rounded-md bg-destructive/10 text-destructive flex items-center gap-2">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <p className="font-medium">Error loading {type}: {error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      ))}
    </div>
  );
}

export default function LeagueScoresPage() {
  const params = useParams();
  const leagueId = params.leagueId ? parseInt(params.leagueId) : undefined;
  const [selectedWeek, setSelectedWeek] = useState<number>();

  if (!leagueId) {
    return (
      <Layout>
        <div className="flex items-center gap-2 p-4 rounded-md bg-destructive/10 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <p>Invalid league ID provided</p>
        </div>
      </Layout>
    );
  }

  const { league, weeks, scores, isLoading, errors } = useLeagueScores({
    leagueId,
    weekNumber: selectedWeek
  });

  ReactuseEffect(() => {
    if (!selectedWeek && weeks.length > 0) {
      setSelectedWeek(weeks[0]);
    }
  }, [weeks, selectedWeek]);

  const weeklyScores = useMemo(() => 
    scores.length > 0 ? organizeBowlerScores(scores) : null,
    [scores]
  );

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
          <LoadingState />
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
          <ErrorDisplay errors={errors} />
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
            <Select
              value={selectedWeek?.toString()}
              onValueChange={(value: string) => setSelectedWeek(parseInt(value))}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select week" />
              </SelectTrigger>
              <SelectContent>
                {weeks.map((week) => (
                  <SelectItem key={week} value={week.toString()}>
                    Week {week}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedWeek && (
              <p className="text-sm text-muted-foreground">
                Showing scores for Week {selectedWeek}
              </p>
            )}
          </div>

          {weeklyScores ? (
            <div className="grid gap-6">
              {groupTeamsByLanes(weeklyScores.teams).map((pair, pairIndex) => (
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
                                {team.bowlers.map((bowler) => {
                                  const seriesTotal = bowler.games
                                    .map(g => g.score)
                                    .filter((score): score is number => score !== null)
                                    .reduce((sum, score) => sum + score, 0);

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
                                      {bowler.games.map((game) => (
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