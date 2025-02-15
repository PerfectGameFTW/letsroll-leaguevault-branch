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
  laneNumber?: number;
  totalPins: number;
  averageScore: number;
  gamesPlayed: number;
  position: number; // Added for matchup pairing
}

interface MatchupPair {
  homeTeam: TeamScores;
  awayTeam: TeamScores;
  lanes: string; // e.g. "1-2" for lanes 1 and 2
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

  // If no week is selected and we have weeks data, default to the latest week
  if (!selectedWeek && weeks.length > 0) {
    setSelectedWeek(weeks[0]);
  }

  // Query for scores with proper error handling
  const { data: scoresResponse, isLoading: loadingScores, error: scoresError } = useQuery({
    queryKey: ["/api/scores", { leagueId, weekNumber: selectedWeek }],
    enabled: !!leagueId && !!selectedWeek,
  });

  // Show loading state with back navigation
  if (loadingLeague || loadingGames || loadingScores) {
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

  const formattedGames = scoresResponse?.data || [];

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
            View weekly scores and matchups for all teams
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
            {formattedGames.map((game, gameIndex) => (
              <div key={gameIndex} className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Game {game.gameNumber}</h3>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  {game.teams.map((teamScore, teamIndex) => (
                    <Card key={teamIndex} className="hover:border-primary/50 transition-colors">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle>{teamScore.teamName}</CardTitle>
                          <div className="text-sm text-muted-foreground">
                            Lane {teamScore.laneNumber}
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-[200px]">Bowler</TableHead>
                              <TableHead className="text-right">Score</TableHead>
                              <TableHead className="text-right">Handicap</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {teamScore.bowlers.map((bowler, index) => (
                              <TableRow key={index}>
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
                                <TableCell
                                  className={cn(
                                    "text-right font-medium",
                                    bowler.score >= 250 && "text-green-600",
                                    bowler.score >= 200 && bowler.score < 250 && "text-primary"
                                  )}
                                >
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span>{bowler.score || "—"}</span>
                                    </TooltipTrigger>
                                    {bowler.score >= 200 && (
                                      <TooltipContent>
                                        {bowler.score >= 250 ? "Perfect game approaching!" : "Great game!"}
                                      </TooltipContent>
                                    )}
                                  </Tooltip>
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground">
                                  {bowler.handicap}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}