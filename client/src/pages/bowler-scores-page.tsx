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
import type { Score, Bowler } from "@shared/schema.js";
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

  // Fetch bowler details
  const { data: bowlerResponse, isLoading: loadingBowler } = useQuery<ApiResponse<Bowler>>({
    queryKey: [`/api/bowlers/${bowlerId}`],
    enabled: !!bowlerId,
  });

  // Fetch all scores for this bowler
  const { data: scoresResponse, isLoading: loadingScores, error: scoresError } = useQuery<ApiResponse<ExtendedScore[]>>({
    queryKey: ["/api/scores", parsedBowlerId],
    queryFn: async () => {
      if (!parsedBowlerId) throw new Error("Bowler ID is required");
      console.log('[BowlerScores] Fetching scores for bowler:', parsedBowlerId);

      const response = await fetch(`/api/scores?bowlerId=${parsedBowlerId}`);
      if (!response.ok) {
        const errorData = await response.json();
        console.error('[BowlerScores] API error:', errorData);
        throw new Error(errorData.error?.message || 'Failed to fetch scores');
      }

      const data = await response.json();
      console.log('[BowlerScores] Received scores data:', data);
      return data;
    },
    enabled: !!parsedBowlerId,
  });

  console.log('[BowlerScores] Component state:', {
    bowler: bowlerResponse?.data,
    scores: scoresResponse?.data,
    loadingBowler,
    loadingScores,
    error: scoresError
  });

  const bowler = bowlerResponse?.data;
  const scores = scoresResponse?.data || [];
  const isLoading = loadingBowler || loadingScores;

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

  // Calculate current average
  const totalPinfall = scores.reduce((sum, score) => sum + score.score, 0);
  const gamesPlayed = scores.length;
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
            ) : scores.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>League</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead className="text-right">Handicap</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scores.map((score) => (
                    <TableRow key={score.id}>
                      <TableCell>
                        {format(new Date(score.game.date), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>{score.league.name}</TableCell>
                      <TableCell>{score.team.name}</TableCell>
                      <TableCell className="text-right">{score.score}</TableCell>
                      <TableCell className="text-right">{score.handicap}</TableCell>
                      <TableCell className="text-right font-medium">
                        {score.score + score.handicap}
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