import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, ArrowLeft, AlertCircle } from "lucide-react";
import type { Game, Score, Team, Bowler, League } from "@shared/schema";
import { format } from "date-fns";
import { Link, useParams } from "wouter";
import { cn } from "@/lib/utils";

interface TeamScores {
  team: Team;
  scores: (Score & { bowler?: Bowler })[];
  games: Game[];
  totalPins: number;
  averageScore: number;
}

export default function LeagueScoresPage() {
  const params = useParams();
  const leagueId = params.leagueId ? parseInt(params.leagueId) : undefined;
  const [selectedWeek, setSelectedWeek] = useState<number>();

  // Validate league ID early
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

  // Query for league details with proper error handling
  const { data: leagueResponse, isLoading: loadingLeague, error: leagueError } = useQuery<{ data: League }>({
    queryKey: [`/api/leagues/${leagueId}`],
    enabled: !!leagueId,
  });

  // Query for games with proper error handling
  const { data: gamesResponse, isLoading: loadingGames, error: gamesError } = useQuery<{ data: Game[] }>({
    queryKey: ["/api/games", { leagueId }],
    enabled: !!leagueId,
  });

  const league = leagueResponse?.data;
  const games = gamesResponse?.data || [];

  // Get unique weeks from games, sorted in descending order
  const weeks = Array.from(new Set(games.map(g => g.weekNumber))).sort((a, b) => b - a);

  // If no week is selected, default to the most recent
  if (!selectedWeek && weeks.length > 0) {
    setSelectedWeek(weeks[0]);
  }

  // Get games for the selected week
  const weekGames = games.filter(g => g.weekNumber === selectedWeek);

  // Query for scores with proper error handling
  const { data: scoresResponse, isLoading: loadingScores, error: scoresError } = useQuery<{ data: Score[] }>({
    queryKey: ["/api/scores", { gameIds: weekGames.map(g => g.id) }],
    enabled: weekGames.length > 0,
  });

  // Query for teams with proper error handling
  const { data: teamsResponse, isLoading: loadingTeams, error: teamsError } = useQuery<{ data: Team[] }>({
    queryKey: ["/api/teams", { leagueId }],
    enabled: !!leagueId,
  });

  // Query for bowlers with proper error handling
  const { data: bowlersResponse, isLoading: loadingBowlers, error: bowlersError } = useQuery<{ data: Bowler[] }>({
    queryKey: ["/api/bowlers"],
  });

  const scores = scoresResponse?.data || [];
  const teams = teamsResponse?.data || [];
  const bowlers = bowlersResponse?.data || [];

  // Show loading state with back navigation
  if (loadingLeague || loadingGames || loadingScores || loadingTeams || loadingBowlers) {
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
          <div className="flex items-center justify-center h-[50vh]">
            <div className="flex items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin" />
              <span className="text-muted-foreground">Loading scores...</span>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // Show errors if any
  const errors = [
    { type: 'league', error: leagueError },
    { type: 'games', error: gamesError },
    { type: 'scores', error: scoresError },
    { type: 'teams', error: teamsError },
    { type: 'bowlers', error: bowlersError },
  ].filter(e => e.error);

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
          {errors.map(({ type, error }) => (
            <div key={type} className="p-4 rounded-md bg-destructive/10 text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              <p className="font-medium">Error loading {type}: {error instanceof Error ? error.message : 'Unknown error'}</p>
            </div>
          ))}
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

  // Calculate team scores and statistics
  const teamScores: TeamScores[] = teams
    .filter(team => team.leagueId === leagueId)
    .map(team => {
      const teamScores = scores
        .filter(s => s.teamId === team.id)
        .map(score => ({
          ...score,
          bowler: bowlers.find(b => b.id === score.bowlerId),
        }))
        .sort((a, b) => a.position - b.position);

      // Calculate team statistics
      const totalPins = teamScores.reduce((sum, score) => sum + (score.score || 0), 0);
      // Use number of actual games (3) per team for average
      const averageScore = teamScores.length > 0 ? Math.round(totalPins / 3) : 0;

      return {
        team,
        scores: teamScores,
        games: weekGames,
        totalPins,
        averageScore,
      };
    })
    .sort((a, b) => b.totalPins - a.totalPins);

  return (
    <Layout>
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
            View weekly scores and statistics for all teams
          </p>
        </div>

        <div className="flex items-center gap-4 mb-6">
          <Select
            value={selectedWeek?.toString()}
            onValueChange={(value) => setSelectedWeek(parseInt(value))}
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

        {weeks.length === 0 ? (
          <div className="text-center p-8 border rounded-lg bg-background">
            <p className="text-lg text-muted-foreground">No games have been recorded for this league yet</p>
            <p className="text-sm text-muted-foreground mt-2">Scores will appear here once games are imported</p>
          </div>
        ) : (
          <div className="grid gap-6">
            {teamScores.map(({ team, scores, games, totalPins, averageScore }) => (
              <Card key={team.id} className="hover:border-primary/50 transition-colors">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle>{team.name}</CardTitle>
                    <div className="text-sm text-muted-foreground">
                      Average: {averageScore} | Total Pins: {totalPins}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[200px]">Bowler</TableHead>
                        {games.map((game, index) => (
                          <TableHead key={game.id} className="text-right">
                            Game {index + 1}
                          </TableHead>
                        ))}
                        <TableHead className="text-right">Series</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {scores.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={games.length + 2}
                            className="text-center text-muted-foreground py-8"
                          >
                            No scores recorded for this team in Week {selectedWeek}
                          </TableCell>
                        </TableRow>
                      ) : (
                        scores.map((score) => {
                          // Get all scores for this bowler's position in current week's games
                          const gameScores = games.map(game =>
                            scores.find(s => s.gameId === game.id && s.position === score.position)
                          );

                          // Calculate series total only from the current week's games
                          const series = gameScores.reduce((sum, s) => sum + (s?.score || 0), 0);

                          return (
                            <TableRow key={`${score.bowlerId}-${score.position}`}>
                              <TableCell>
                                {score.isVacant ? (
                                  <span className="text-muted-foreground italic">Vacant</span>
                                ) : score.isAbsent ? (
                                  <span className="text-muted-foreground italic">Absent</span>
                                ) : score.bowler ? (
                                  <div className="flex items-center gap-2">
                                    <Link
                                      href={`/bowlers/${score.bowler.id}`}
                                      className="hover:underline"
                                    >
                                      {score.bowler.name}
                                    </Link>
                                    {score.isSub && (
                                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                                        Sub
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">Unknown Bowler</span>
                                )}
                              </TableCell>
                              {gameScores.map((gameScore, i) => (
                                <TableCell
                                  key={i}
                                  className={cn(
                                    "text-right font-medium",
                                    gameScore?.score && gameScore.score >= 250 && "text-green-600",
                                    gameScore?.score && gameScore.score >= 200 && gameScore.score < 250 && "text-primary",
                                  )}
                                >
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span>{gameScore?.score || "-"}</span>
                                    </TooltipTrigger>
                                    {gameScore?.score && gameScore.score >= 200 && (
                                      <TooltipContent>
                                        {gameScore.score >= 250 ? "Perfect game approaching!" : "Great game!"}
                                      </TooltipContent>
                                    )}
                                  </Tooltip>
                                </TableCell>
                              ))}
                              <TableCell
                                className={cn(
                                  "text-right font-medium",
                                  series >= 700 && "text-green-600",
                                  series >= 600 && series < 700 && "text-primary"
                                )}
                              >
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span>{series || "—"}</span>
                                  </TooltipTrigger>
                                  {series >= 600 && (
                                    <TooltipContent>
                                      {series >= 700 ? "Outstanding series!" : "Great series!"}
                                    </TooltipContent>
                                  )}
                                </Tooltip>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}