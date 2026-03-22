import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.js";
import { Loader2, ArrowLeft } from "lucide-react";
import type { Score, Bowler } from "@shared/schema";
import { format } from "date-fns";
import { Link, useParams } from "wouter";

interface ExtendedScore extends Score {
  game: {
    id: number;
    leagueId: number;
    weekNumber: number;
    gameNumber: number;
    date: string;
  };
  team: {
    id: number;
    name: string;
    number: number;
    leagueId: number;
    active: boolean;
  };
  league: {
    id: number;
    name: string;
    description: string | null;
    active: boolean;
  };
}

interface WeeklyScores {
  date: string;
  weekNumber: number;
  games: (ExtendedScore | null)[];
  seriesTotal: number;
  league: {
    id: number;
    name: string;
  };
  team: {
    id: number;
    name: string;
  };
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    message: string;
    code?: string;
  };
}

export default function BowlerScoresPage() {
  const { bowlerId } = useParams<{ bowlerId: string }>();
  const parsedBowlerId = bowlerId ? parseInt(bowlerId) : undefined;

  const { data: bowlerResponse, isLoading: loadingBowler } = useQuery<ApiResponse<Bowler>>({
    queryKey: [`/api/bowlers/${bowlerId}`],
    enabled: !!bowlerId,
  });

  // Use historical scores endpoint for complete history
  const { data: scoresResponse, isLoading: loadingScores, error: scoresError } = useQuery<ApiResponse<ExtendedScore[]>>({
    queryKey: ["/api/scores/history", parsedBowlerId],
    queryFn: async () => {
      if (!parsedBowlerId) throw new Error("Bowler ID is required");
      const response = await fetch(`/api/scores/history?bowlerId=${parsedBowlerId}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to fetch scores');
      }
      return response.json();
    },
    enabled: !!parsedBowlerId,
  });

  const bowler = bowlerResponse?.data;
  const scores = scoresResponse?.data || [];
  const isLoading = loadingBowler || loadingScores;

  // Group scores by week and calculate series totals
  const weeklyScores: WeeklyScores[] = scores.reduce((weeks: WeeklyScores[], score) => {
    const weekIndex = weeks.findIndex(w => 
      w.weekNumber === score.game.weekNumber && 
      w.date === score.game.date
    );

    if (weekIndex === -1) {
      // Create new week entry
      const newWeek: WeeklyScores = {
        date: score.game.date,
        weekNumber: score.game.weekNumber,
        games: Array(3).fill(null),
        seriesTotal: score.score || 0,
        league: {
          id: score.league.id,
          name: score.league.name,
        },
        team: {
          id: score.team.id,
          name: score.team.name,
        }
      };
      newWeek.games[score.game.gameNumber - 1] = score;
      weeks.push(newWeek);
    } else {
      // Update existing week
      weeks[weekIndex].games[score.game.gameNumber - 1] = score;
      if (!score.isAbsent && !score.isVacant && score.score !== null) {
        weeks[weekIndex].seriesTotal += score.score;
      }
    }

    return weeks;
  }, []);

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!bowler) {
    return (
      <Layout>
        <div className="text-center text-destructive">Bowler not found</div>
      </Layout>
    );
  }

  // Calculate current average from all historical games
  const validScores = scores.filter(s => !s.isAbsent && !s.isVacant && s.score !== null);

  const totalPinfall = validScores.reduce((sum, score) => {
    return sum + (score.score || 0);
  }, 0);

  const gamesPlayed = validScores.length;

  const currentAverage = gamesPlayed > 0 ? Math.round(totalPinfall / gamesPlayed) : 0;

  return (
    <Layout>
      <div className="space-y-6">
        <Link
          href={`/bowlers/${bowlerId}`}
          className="text-muted-foreground hover:text-foreground flex items-center"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Bowler
        </Link>

        <div>
          <h1 className="text-2xl font-bold mb-2">{bowler.name}'s Recent Scores</h1>
          <p className="text-muted-foreground">
            View recent scores and statistics
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Current Average</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{currentAverage}</p>
              <p className="text-sm text-muted-foreground">
                Based on {gamesPlayed} games
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="pt-6">
            {scoresError ? (
              <div className="text-center text-destructive py-8">
                Error loading scores: {scoresError.message}
              </div>
            ) : weeklyScores.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Week</TableHead>
                    <TableHead className="text-right">Game 1</TableHead>
                    <TableHead className="text-right">Game 2</TableHead>
                    <TableHead className="text-right">Game 3</TableHead>
                    <TableHead className="text-right">Series</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {weeklyScores.map((week) => (
                    <TableRow key={`${week.date}-${week.weekNumber}`}>
                      <TableCell>{format(new Date(week.date), "MMM d, yyyy")}</TableCell>
                      <TableCell>{week.weekNumber}</TableCell>
                      {week.games.map((game, index) => (
                        <TableCell key={index} className="text-right">
                          {game?.isVacant ? "VACANT" :
                           game?.isAbsent ? "ABSENT" :
                           game?.score || "—"}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-medium">
                        {week.seriesTotal || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center text-muted-foreground py-8">
                No scores recorded yet
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}