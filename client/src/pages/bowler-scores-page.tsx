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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.js";
import { Loader2, ArrowLeft } from "lucide-react";
import type { Score, Bowler } from "@shared/schema.js";
import { format } from "date-fns";
import { Link, useParams } from "wouter";

// Updated to match the API response structure
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
}

export default function BowlerScoresPage() {
  const params = useParams<{ bowlerId: string }>();
  const bowlerId = params.bowlerId ? parseInt(params.bowlerId) : undefined;

  // Fetch bowler details
  const { data: bowlerResponse, isLoading: loadingBowler } = useQuery<ApiResponse<Bowler>>({
    queryKey: [`/api/bowlers/${bowlerId}`],
    enabled: !!bowlerId,
  });

  // Fetch all scores for this bowler
  const { data: scoresResponse, isLoading: loadingScores } = useQuery<ApiResponse<ExtendedScore[]>>({
    queryKey: ["/api/scores", { bowlerId }],
    enabled: !!bowlerId,
  });

  console.log('[BowlerScores] Responses:', {
    bowler: bowlerResponse,
    scores: scoresResponse
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
          <h1 className="text-2xl font-bold mb-2">{bowler.name}'s Scores</h1>
          <p className="text-muted-foreground">
            View scores and statistics
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

        <Tabs defaultValue="recent">
          <TabsList>
            <TabsTrigger value="recent">Recent Games</TabsTrigger>
            <TabsTrigger value="history">Score History</TabsTrigger>
          </TabsList>

          <TabsContent value="recent">
            <Card>
              <CardContent className="pt-6">
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
                    {scores.map((score, index) => (
                      <TableRow key={index}>
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
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardContent className="pt-6">
                <p className="text-center text-muted-foreground">
                  Score history visualization will be implemented here
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}