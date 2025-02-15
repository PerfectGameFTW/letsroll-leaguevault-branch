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
import { TooltipProvider, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, ArrowLeft, AlertCircle } from "lucide-react";
import type { Game, Score, Team, Bowler, League } from "@shared/schema";
import { format } from "date-fns";
import { Link, useParams } from "wouter";
import { cn } from "@/lib/utils";

interface BowlerScores {
  bowlerId: number;
  bowlerName: string;
  position: number;
  isVacant: boolean;
  isAbsent: boolean;
  isSub: boolean;
  handicap: number | null;
  games: {
    gameNumber: number;
    score: number | null;
  }[];
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
  // Sort teams by lane number first
  const sortedTeams = [...teams].sort((a, b) => a.laneNumber - b.laneNumber);
  const pairs: LanePair[] = [];

  // Process all teams
  for (let i = 0; i < sortedTeams.length; i++) {
    const currentTeam = sortedTeams[i];

    // Find the matching team on the adjacent lane
    const matchingTeam = sortedTeams.find(
      team => team.laneNumber === currentTeam.laneNumber + 1 || 
              team.laneNumber === currentTeam.laneNumber - 1
    );

    // If this team hasn't been processed yet
    if (!pairs.some(pair => 
      pair.homeTeam.teamId === currentTeam.teamId || 
      (pair.awayTeam && pair.awayTeam.teamId === currentTeam.teamId)
    )) {
      if (matchingTeam) {
        // Create a new pair with both teams
        pairs.push({
          lanes: `Lanes ${Math.min(currentTeam.laneNumber, matchingTeam.laneNumber)} & ${Math.max(currentTeam.laneNumber, matchingTeam.laneNumber)}`,
          homeTeam: currentTeam.laneNumber < matchingTeam.laneNumber ? currentTeam : matchingTeam,
          awayTeam: currentTeam.laneNumber < matchingTeam.laneNumber ? matchingTeam : currentTeam
        });
      } else {
        // Handle single lane case
        pairs.push({
          lanes: `Lane ${currentTeam.laneNumber}`,
          homeTeam: currentTeam,
          awayTeam: undefined
        });
      }
    }
  }

  // Sort pairs by lane number
  return pairs.sort((a, b) => {
    const aLane = a.homeTeam.laneNumber;
    const bLane = b.homeTeam.laneNumber;
    return aLane - bLane;
  });
}

function organizeBowlerScores(scoresData: any[]): WeeklyScores {
  const teams = new Map<number, TeamScores>();

  scoresData.forEach(game => {
    game.teams.forEach((team: any) => {
      if (!teams.has(team.teamId)) {
        teams.set(team.teamId, {
          teamId: team.teamId,
          teamName: team.teamName,
          teamNumber: team.teamNumber,
          laneNumber: team.laneNumber,
          bowlers: new Map()
        });
      }

      team.bowlers.forEach((bowler: any) => {
        const currentTeam = teams.get(team.teamId)!;
        if (!currentTeam.bowlers.has(bowler.bowlerId)) {
          currentTeam.bowlers.set(bowler.bowlerId, {
            bowlerId: bowler.bowlerId,
            bowlerName: bowler.bowlerName,
            position: bowler.position,
            isVacant: bowler.isVacant,
            isAbsent: bowler.isAbsent,
            isSub: bowler.isSub,
            handicap: bowler.handicap,
            games: []
          });
        }

        const bowlerData = currentTeam.bowlers.get(bowler.bowlerId)!;
        bowlerData.games.push({
          gameNumber: game.gameNumber,
          score: bowler.score
        });
      });
    });
  });

  const organizedTeams = Array.from(teams.values()).map(team => ({
    ...team,
    bowlers: Array.from(team.bowlers.values())
      .sort((a, b) => a.position - b.position)
      .map(bowler => ({
        ...bowler,
        games: bowler.games.sort((a, b) => a.gameNumber - b.gameNumber)
      }))
  }));

  return {
    weekNumber: scoresData[0]?.weekNumber || 0,
    date: scoresData[0]?.date || "",
    teams: organizedTeams.sort((a, b) => a.laneNumber - b.laneNumber)
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

  const { data: gamesResponse, isLoading: loadingGames, error: gamesError } = useQuery<{ data: Game[] }>({
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

  const games = gamesResponse?.data || [];

  const weeks = Array.from(new Set(games.map(g => g.weekNumber))).sort((a, b) => b - a);

  if (!selectedWeek && weeks.length > 0) {
    setSelectedWeek(weeks[0]);
  }

  const { data: scoresResponse, isLoading: loadingScores, error: scoresError } = useQuery({
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

  const { data: leagueResponse, isLoading: loadingLeague, error: leagueError } = useQuery<{ data: League }>({
    queryKey: [`/api/leagues/${leagueId}`],
    enabled: !!leagueId,
  });

  const league = leagueResponse?.data;
  const formattedGames = scoresResponse?.data || [];

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
                                        {bowler.handicap || "—"}
                                      </TableCell>
                                      {bowler.games.map((game) => (
                                        <TableCell
                                          key={game.gameNumber}
                                          className={cn(
                                            "text-right font-medium",
                                            game.score >= 250 && "text-green-600",
                                            game.score >= 200 && game.score < 250 && "text-primary"
                                          )}
                                        >
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <span>{game.score || "—"}</span>
                                            </TooltipTrigger>
                                            {game.score >= 200 && (
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