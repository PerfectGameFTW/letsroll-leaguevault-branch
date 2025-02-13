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

export default function LeagueScoresPage() {
  const params = useParams();
  const leagueId = params.leagueId ? parseInt(params.leagueId) : undefined;
  const [selectedWeek, setSelectedWeek] = useState<number>();

  // Fetch league details
  const { data: leagueResponse, isLoading: loadingLeague } = useQuery<{ data: League }>({
    queryKey: [`/api/leagues/${leagueId}`],
    enabled: !!leagueId,
  });

  // Fetch games for the league
  const { data: gamesResponse, isLoading: loadingGames } = useQuery<{ data: Game[] }>({
    queryKey: ["/api/games", { leagueId }],
    enabled: !!leagueId,
  });

  const league = leagueResponse?.data;
  const games = gamesResponse?.data || [];

  // Get unique weeks from games
  const weeks = [...new Set(games.map(g => g.weekNumber))].sort((a, b) => b - a);

  // If no week is selected, default to the most recent
  if (!selectedWeek && weeks.length > 0) {
    setSelectedWeek(weeks[0]);
  }

  // Fetch scores for the selected week
  const { data: scoresResponse, isLoading: loadingScores } = useQuery<{ data: Score[] }>({
    queryKey: ["/api/scores", { weekNumber: selectedWeek }],
    enabled: !!selectedWeek,
  });

  // Fetch teams
  const { data: teamsResponse, isLoading: loadingTeams } = useQuery<{ data: Team[] }>({
    queryKey: ["/api/teams", { leagueId }],
    enabled: !!leagueId,
  });

  // Fetch bowlers
  const { data: bowlersResponse, isLoading: loadingBowlers } = useQuery<{ data: Bowler[] }>({
    queryKey: ["/api/bowlers"],
  });

  const scores = scoresResponse?.data || [];
  const teams = teamsResponse?.data || [];
  const bowlers = bowlersResponse?.data || [];

  const isLoading = loadingLeague || loadingGames || loadingScores || loadingTeams || loadingBowlers;

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
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

  // Group scores by team
  const scoresByTeam = teams.reduce((acc, team) => {
    const teamScores = scores.filter(s => s.teamId === team.id);
    if (teamScores.length > 0) {
      acc[team.id] = {
        team,
        scores: teamScores.sort((a, b) => a.position - b.position),
      };
    }
    return acc;
  }, {} as Record<number, { team: Team; scores: Score[] }>);

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
        </div>

        <div className="grid gap-6">
          {Object.values(scoresByTeam).map(({ team, scores }) => (
            <Card key={team.id}>
              <CardHeader>
                <CardTitle>{team.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bowler</TableHead>
                      <TableHead className="text-right">Game 1</TableHead>
                      <TableHead className="text-right">Game 2</TableHead>
                      <TableHead className="text-right">Game 3</TableHead>
                      <TableHead className="text-right">Series</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {scores.map((score) => {
                      const bowler = bowlers.find(b => b.id === score.bowlerId);
                      return (
                        <TableRow key={score.id}>
                          <TableCell>
                            {score.isVacant ? (
                              <span className="text-muted-foreground">Vacant</span>
                            ) : score.isAbsent ? (
                              <span className="text-muted-foreground">Absent</span>
                            ) : bowler ? (
                              <Link
                                href={`/bowlers/${bowler.id}`}
                                className="hover:underline"
                              >
                                {bowler.name}
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
                          <TableCell className="text-right">{score.score}</TableCell>
                          <TableCell className="text-right">{score.handicap}</TableCell>
                          <TableCell className="text-right">{score.average}</TableCell>
                          <TableCell className="text-right font-medium">
                            {score.score + score.handicap}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </Layout>
  );
}
