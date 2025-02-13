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
import { Loader2, ArrowLeft } from "lucide-react";
import type { Game, Score, Team, Bowler, League } from "@shared/schema";
import { format } from "date-fns";
import { Link, useParams } from "wouter";

interface TeamScores {
  team: Team;
  scores: (Score & { bowler?: Bowler })[];
  games: Game[];
}

export default function LeagueScoresPage() {
  const params = useParams();
  const leagueId = params.leagueId ? parseInt(params.leagueId) : undefined;
  const [selectedWeek, setSelectedWeek] = useState<number>();

  // Fetch league details
  const { data: leagueResponse, isLoading: loadingLeague, error: leagueError } = useQuery<{ data: League }>({
    queryKey: [`/api/leagues/${leagueId}`],
    enabled: !!leagueId,
  });

  // Fetch games for the league
  const { data: gamesResponse, isLoading: loadingGames, error: gamesError } = useQuery<{ data: Game[] }>({
    queryKey: ["/api/games", { leagueId }],
    enabled: !!leagueId,
  });

  const league = leagueResponse?.data;
  const games = gamesResponse?.data || [];

  // Get unique weeks from games
  const weeks = Array.from(new Set(games.map(g => g.weekNumber))).sort((a, b) => b - a);

  // If no week is selected, default to the most recent
  if (!selectedWeek && weeks.length > 0) {
    setSelectedWeek(weeks[0]);
  }

  // Get games for the selected week
  const weekGames = games.filter(g => g.weekNumber === selectedWeek);

  // Fetch scores for the selected week's games
  const { data: scoresResponse, isLoading: loadingScores, error: scoresError } = useQuery<{ data: Score[] }>({
    queryKey: ["/api/scores", { gameIds: weekGames.map(g => g.id) }],
    enabled: weekGames.length > 0,
  });

  // Fetch teams
  const { data: teamsResponse, isLoading: loadingTeams, error: teamsError } = useQuery<{ data: Team[] }>({
    queryKey: ["/api/teams", { leagueId }],
    enabled: !!leagueId,
  });

  // Fetch bowlers
  const { data: bowlersResponse, isLoading: loadingBowlers, error: bowlersError } = useQuery<{ data: Bowler[] }>({
    queryKey: ["/api/bowlers"],
  });

  const scores = scoresResponse?.data || [];
  const teams = teamsResponse?.data || [];
  const bowlers = bowlersResponse?.data || [];

  // Show loading state
  if (loadingLeague || loadingGames || loadingScores || loadingTeams || loadingBowlers) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
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
          {errors.map(({ type, error }) => (
            <div key={type} className="p-4 rounded-md bg-destructive/10 text-destructive">
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
        <div className="text-center text-destructive">League not found</div>
      </Layout>
    );
  }

  // Group scores by team and add bowler information
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

      return {
        team,
        scores: teamScores,
        games: weekGames,
      };
    });

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
          <p className="text-muted-foreground">
            View weekly scores and statistics
          </p>
        </div>

        <div className="flex items-center gap-4">
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
          <div className="text-center text-muted-foreground py-8">
            No games recorded for this league yet
          </div>
        ) : (
          <div className="grid gap-6">
            {teamScores.map(({ team, scores, games }) => (
              <Card key={team.id}>
                <CardHeader>
                  <CardTitle>{team.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bowler</TableHead>
                        {games.map((game, index) => (
                          <TableHead key={game.id} className="text-right">
                            Game {index + 1}
                          </TableHead>
                        ))}
                        <TableHead className="text-right">Series</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {scores.length > 0 ? (
                        scores.map((score) => {
                          const gameScores = games.map(game => 
                            scores.find(s => s.gameId === game.id && s.position === score.position)
                          );
                          const series = gameScores.reduce((sum, s) => sum + (s?.score || 0), 0);

                          return (
                            <TableRow key={`${score.bowlerId}-${score.position}`}>
                              <TableCell>
                                {score.isVacant ? (
                                  <span className="text-muted-foreground">Vacant</span>
                                ) : score.isAbsent ? (
                                  <span className="text-muted-foreground">Absent</span>
                                ) : score.bowler ? (
                                  <Link
                                    href={`/bowlers/${score.bowler.id}`}
                                    className="hover:underline"
                                  >
                                    {score.bowler.name}
                                    {score.isSub && (
                                      <span className="ml-2 text-xs text-muted-foreground">
                                        (Sub)
                                      </span>
                                    )}
                                  </Link>
                                ) : (
                                  "Unknown Bowler"
                                )}
                              </TableCell>
                              {gameScores.map((gameScore, i) => (
                                <TableCell key={i} className="text-right">
                                  {gameScore?.score || "-"}
                                </TableCell>
                              ))}
                              <TableCell className="text-right font-medium">
                                {series}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      ) : (
                        <TableRow>
                          <TableCell
                            colSpan={games.length + 2}
                            className="text-center text-muted-foreground"
                          >
                            No scores recorded for this team
                          </TableCell>
                        </TableRow>
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