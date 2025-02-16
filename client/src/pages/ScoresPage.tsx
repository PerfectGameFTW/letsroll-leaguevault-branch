import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Layout } from "@/components/layout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import type { DetailedScore } from "@shared/schema";
import type { ApiResponse } from "@/lib/types/api";

interface ScoresByBowler {
  bowlerId: number;
  bowlerName: string;
  teamId: number;
  teamName: string;
  date: string;
  weekNumber: number;
  games: DetailedScore[];
  seriesTotal: number | null;
}

export default function ScoresPage() {
  const { leagueId, weekNumber } = useParams<{ leagueId: string; weekNumber: string }>();
  const parsedLeagueId = parseInt(leagueId);
  const parsedWeekNumber = parseInt(weekNumber);

  const { data: scoresResponse, isLoading, error } = useQuery<ApiResponse<ScoresByBowler[]>>({
    queryKey: ['/api/scores', parsedLeagueId, parsedWeekNumber],
    queryFn: async () => {
      if (isNaN(parsedLeagueId) || isNaN(parsedWeekNumber)) {
        throw new Error('Invalid league ID or week number');
      }

      const response = await fetch(`/api/scores?leagueId=${parsedLeagueId}&weekNumber=${parsedWeekNumber}`);
      if (!response.ok) {
        throw new Error('Failed to fetch scores');
      }
      const data: ApiResponse<ScoresByBowler[]> = await response.json();
      if (!data.success) {
        throw new Error(data.error?.message || 'Failed to fetch scores');
      }
      return data;
    },
    enabled: !isNaN(parsedLeagueId) && !isNaN(parsedWeekNumber),
  });

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      </Layout>
    );
  }

  if (error || !scoresResponse?.data) {
    return (
      <Layout>
        <div className="space-y-4">
          <Link href={`/leagues/${leagueId}`} className="text-muted-foreground hover:text-foreground flex items-center mb-4">
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
        <Link href={`/leagues/${leagueId}`} className="text-muted-foreground hover:text-foreground flex items-center">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to League
        </Link>

        <div>
          <h1 className="text-2xl font-bold mb-2">Weekly Scores</h1>
          <p className="text-muted-foreground mb-6">
            Week {weekNumber} Scores and Statistics
          </p>
        </div>

        <Card className="p-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Week</TableHead>
                <TableHead>Bowler</TableHead>
                <TableHead>Team</TableHead>
                <TableHead className="text-right">Game 1</TableHead>
                <TableHead className="text-right">Game 2</TableHead>
                <TableHead className="text-right">Game 3</TableHead>
                <TableHead className="text-right">Series</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scoresResponse.data.map((bowler) => {
                const validScores = bowler.games
                  .map(g => g.score)
                  .filter((score): score is number => score !== null);

                const seriesTotal = validScores.length > 0 
                  ? validScores.reduce((sum, score) => sum + score, 0)
                  : null;

                return (
                  <TableRow key={`${bowler.bowlerId}-${bowler.teamId}`}>
                    <TableCell>{format(new Date(bowler.date), "MMM d, yyyy")}</TableCell>
                    <TableCell>{bowler.weekNumber}</TableCell>
                    <TableCell>
                      <Link href={`/bowlers/${bowler.bowlerId}`} className="hover:underline">
                        {bowler.bowlerName}
                        {bowler.games.some(g => g.isSub) && (
                          <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                            Sub
                          </span>
                        )}
                      </Link>
                    </TableCell>
                    <TableCell>{bowler.teamName}</TableCell>
                    {bowler.games.map((game, index) => (
                      <TableCell key={index} className="text-right">
                        {game.isVacant ? "VACANT" :
                         game.isAbsent ? "ABSENT" :
                         game.score === null ? "—" :
                         game.score}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-medium">
                      {seriesTotal === null ? "—" : seriesTotal}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      </div>
    </Layout>
  );
}