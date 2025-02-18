import { useParams, Link } from "wouter";
import { Layout } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { ApiResponse } from "@/lib/types/api";

interface Game {
  score: number | null;
  handicap: number | null;
}

interface Bowler {
  bowlerId: number;
  bowlerName: string;
  handicap: number;
  games: Game[];
  isVacant: boolean;
  isAbsent: boolean;
  isSub: boolean;
  position: number;
}

interface Team {
  teamId: number;
  teamName: string;
  teamNumber: number;
  bowlers: Bowler[];
}

interface LanePair {
  lanes: string;
  homeTeam: Team;
  awayTeam: Team | null;
}

export default function ScoresPage() {
  const { leagueId: rawLeagueId, weekNumber: rawWeekNumber } = useParams<{ leagueId: string; weekNumber: string }>();

  const leagueId = rawLeagueId ? parseInt(rawLeagueId, 10) : undefined;
  const weekNumber = rawWeekNumber ? parseInt(rawWeekNumber, 10) : undefined;

  if (!leagueId || isNaN(leagueId) || !weekNumber || isNaN(weekNumber)) {
    return (
      <Layout>
        <div className="p-4 rounded-md bg-destructive/10 text-destructive flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          <p>Invalid league ID or week number provided</p>
        </div>
      </Layout>
    );
  }

  const { data: scoresResponse, isLoading, error } = useQuery<ApiResponse<LanePair[]>>({
    queryKey: ['/api/scores', leagueId, weekNumber],
    enabled: true
  });

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  if (error || !scoresResponse?.data) {
    return (
      <Layout>
        <div className="space-y-4">
          <Link
            href={`/leagues/${rawLeagueId}`}
            className="text-muted-foreground hover:text-foreground flex items-center mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to League
          </Link>
          <div className="p-4 rounded-md bg-destructive/10 text-destructive flex items-center gap-2">
            <AlertCircle className="h-5 w-5 flex-shrink-0" />
            <p>Error loading scores: {error instanceof Error ? error.message : 'Unknown error'}</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <Link
          href={`/leagues/${rawLeagueId}`}
          className="text-muted-foreground hover:text-foreground flex items-center"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to League
        </Link>

        <div>
          <h1 className="text-2xl font-bold mb-2">League Scores</h1>
          <p className="text-muted-foreground mb-6">
            Week {rawWeekNumber} Scores
          </p>
        </div>

        <div className="grid gap-6">
          {scoresResponse.data.map((lanePair, index) => (
            <Card key={index}>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg font-semibold text-primary">
                  {lanePair.lanes}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-8">
                  {[lanePair.homeTeam, lanePair.awayTeam].map((team, teamIndex) => (
                    team && (
                      <div key={team.teamId} className="space-y-2">
                        <h4 className="font-medium">
                          {team.teamName}
                        </h4>
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
                                      className="text-right"
                                    >
                                      {game?.score ?? "—"}
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
      </div>
    </Layout>
  );
}