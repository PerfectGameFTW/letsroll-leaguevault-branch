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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, ArrowLeft } from "lucide-react";
import type { Score, Bowler, Game, League, Team } from "@shared/schema";
import { format } from "date-fns";
import { Link, useParams } from "wouter";

export default function BowlerScoresPage() {
  const params = useParams();
  const bowlerId = params.bowlerId ? parseInt(params.bowlerId) : undefined;

  // Fetch bowler details
  const { data: bowlerResponse, isLoading: loadingBowler } = useQuery<{ data: Bowler }>({
    queryKey: [`/api/bowlers/${bowlerId}`],
    enabled: !!bowlerId,
  });

  // Fetch all scores for this bowler
  const { data: scoresResponse, isLoading: loadingScores } = useQuery<{ data: Score[] }>({
    queryKey: ["/api/scores", { bowlerId }],
    enabled: !!bowlerId,
  });

  // Fetch games to get dates and week numbers
  const { data: gamesResponse, isLoading: loadingGames } = useQuery<{ data: Game[] }>({
    queryKey: ["/api/games"],
  });

  // Fetch leagues and teams for context
  const { data: leaguesResponse, isLoading: loadingLeagues } = useQuery<{ data: League[] }>({
    queryKey: ["/api/leagues"],
  });

  const { data: teamsResponse, isLoading: loadingTeams } = useQuery<{ data: Team[] }>({
    queryKey: ["/api/teams"],
  });

  const bowler = bowlerResponse?.data;
  const scores = scoresResponse?.data || [];
  const games = gamesResponse?.data || [];
  const leagues = leaguesResponse?.data || [];
  const teams = teamsResponse?.data || [];

  const isLoading = loadingBowler || loadingScores || loadingGames || loadingLeagues || loadingTeams;

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

  // Calculate statistics
  const recentScores = scores
    .map(score => {
      const game = games.find(g => g.id === score.gameId);
      const league = game ? leagues.find(l => l.id === game.leagueId) : undefined;
      const team = teams.find(t => t.id === score.teamId);
      return {
        ...score,
        game,
        league,
        team,
      };
    })
    .sort((a, b) => {
      if (!a.game?.date || !b.game?.date) return 0;
      return new Date(b.game.date).getTime() - new Date(a.game.date).getTime();
    });

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
                    {recentScores.map((score) => (
                      <TableRow key={score.id}>
                        <TableCell>
                          {score.game?.date ? (
                            format(new Date(score.game.date), "MMM d, yyyy")
                          ) : (
                            "Unknown"
                          )}
                        </TableCell>
                        <TableCell>{score.league?.name || "Unknown League"}</TableCell>
                        <TableCell>{score.team?.name || "Unknown Team"}</TableCell>
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
