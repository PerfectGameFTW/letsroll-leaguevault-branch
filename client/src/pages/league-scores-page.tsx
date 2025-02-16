import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@components/layout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@ui/card";
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from "@ui/tooltip";
import { Loader2, ArrowLeft, AlertCircle } from "lucide-react";
import type { Game, Score, Team, Bowler, League, ApiResponse } from "@shared/schema";
import { format } from "date-fns";
import { Link, useParams } from "wouter";
import { cn } from "@lib/utils";

interface BowlerScores {
  bowlerId: number;
  bowlerName: string;
  position: number;
  isVacant: boolean;
  isAbsent: boolean;
  isSub: boolean;
  handicap: number | null;
  games: Array<{
    gameNumber: number;
    score: number | null;
  }>;
}

interface TeamScores {
  teamId: number;
  teamName: string;
  teamNumber: number;
  laneNumber: number;
  bowlers: BowlerScores[];
}

interface WeeklyScores {
  weekNumber: number;
  date: string;
  teams: TeamScores[];
}

interface LanePair {
  lanes: string;
  homeTeam: TeamScores;
  awayTeam: TeamScores | undefined;
}

function groupTeamsByLanes(teams: TeamScores[]): LanePair[] {
  const laneMap = new Map<number, TeamScores>();
  teams.forEach(team => laneMap.set(team.laneNumber, team));

  const pairs: LanePair[] = [];
  const laneNumbers = Array.from(laneMap.keys()).sort((a, b) => a - b);

  for (let i = 0; i < laneNumbers.length; i++) {
    const currentLane = laneNumbers[i];
    const currentTeam = laneMap.get(currentLane)!;

    const alreadyProcessed = pairs.some(p =>
      p.homeTeam.laneNumber === currentLane ||
      (p.awayTeam && p.awayTeam.laneNumber === currentLane)
    );

    if (alreadyProcessed) continue;

    const pairedLane = currentLane % 2 === 0 ? currentLane - 1 : currentLane + 1;
    const pairedTeam = laneMap.get(pairedLane);

    if (pairedTeam) {
      const [lowerLane, higherLane] = currentLane < pairedLane
        ? [currentLane, pairedLane]
        : [pairedLane, currentLane];

      const [homeTeam, awayTeam] = currentLane < pairedLane
        ? [currentTeam, pairedTeam]
        : [pairedTeam, currentTeam];

      pairs.push({
        lanes: `Lanes ${lowerLane} & ${higherLane}`,
        homeTeam,
        awayTeam
      });
    } else {
      pairs.push({
        lanes: `Lane ${currentLane}`,
        homeTeam: currentTeam,
        awayTeam: undefined
      });
    }
  }

  return pairs.sort((a, b) => a.homeTeam.laneNumber - b.homeTeam.laneNumber);
}

function organizeBowlerScores(scoresData: Game[]): WeeklyScores {
  const teams = new Map<number, Omit<TeamScores, 'bowlers'> & { bowlers: Map<number, BowlerScores> }>();

  scoresData.forEach(game => {
    game.teams.forEach((team: Team & { bowlers: Array<Bowler & { score: number | null }> }) => {
      if (!teams.has(team.id)) {
        teams.set(team.id, {
          teamId: team.id,
          teamName: team.name,
          teamNumber: team.number,
          laneNumber: team.laneNumber,
          bowlers: new Map(),
        });
      }

      const currentTeam = teams.get(team.id)!;
      team.bowlers.forEach(bowler => {
        if (!currentTeam.bowlers.has(bowler.id)) {
          currentTeam.bowlers.set(bowler.id, {
            bowlerId: bowler.id,
            bowlerName: bowler.name,
            position: bowler.position,
            isVacant: bowler.isVacant,
            isAbsent: bowler.isAbsent,
            isSub: bowler.isSub,
            handicap: bowler.handicap,
            games: [],
          });
        }

        const bowlerData = currentTeam.bowlers.get(bowler.id)!;
        bowlerData.games.push({
          gameNumber: game.gameNumber,
          score: bowler.score,
        });
      });
    });
  });

  return {
    weekNumber: scoresData[0]?.weekNumber ?? 0,
    date: scoresData[0]?.date ?? "",
    teams: Array.from(teams.values()).map(team => ({
      ...team,
      bowlers: Array.from(team.bowlers.values())
        .sort((a, b) => a.position - b.position)
        .map(bowler => ({
          ...bowler,
          games: bowler.games.sort((a, b) => a.gameNumber - b.gameNumber),
        })),
    })),
  };
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

  const { data: gamesResponse, isLoading: loadingGames, error: gamesError } = useQuery<ApiResponse<Game[]>>({
    queryKey: ["/api/games", { leagueId }],
    queryFn: async () => {
      const response = await fetch(`/api/games?leagueId=${leagueId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch games');
      }
      return response.json();
    },
    enabled: !!leagueId,
  });

  const games = gamesResponse?.data ?? [];
  const weeks = Array.from(new Set(games.map(g => g.weekNumber))).sort((a, b) => b - a);

  if (!selectedWeek && weeks.length > 0) {
    setSelectedWeek(weeks[0]);
  }

  const { data: scoresResponse, isLoading: loadingScores, error: scoresError } = useQuery<ApiResponse<Game[]>>({
    queryKey: ["/api/scores", { leagueId, weekNumber: selectedWeek }],
    queryFn: async () => {
      if (!selectedWeek) throw new Error('No week selected');
      const response = await fetch(`/api/scores?leagueId=${leagueId}&weekNumber=${selectedWeek}`);
      if (!response.ok) {
        throw new Error('Failed to fetch scores');
      }
      return response.json();
    },
    enabled: !!leagueId && !!selectedWeek,
  });

  const { data: leagueResponse, isLoading: loadingLeague, error: leagueError } = useQuery<ApiResponse<League>>({
    queryKey: [`/api/leagues/${leagueId}`],
    enabled: !!leagueId,
  });

  const league = leagueResponse?.data;
  const formattedGames = scoresResponse?.data ?? [];

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

  const weeklyScores = formattedGames.length > 0 ? organizeBowlerScores(formattedGames) : null;

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