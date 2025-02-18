import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout";
import { LeagueForm } from "@/components/league-form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Pencil } from "lucide-react";
import type { League, Team } from "@shared/schema";
import type { ScoreWithRelations } from "@/lib/types/scores";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format, differenceInWeeks } from "date-fns";
import { Link } from "wouter";

export default function LeaguesPage() {
  const [showForm, setShowForm] = useState(false);
  const [selectedLeague, setSelectedLeague] = useState<League | undefined>();
  const { toast } = useToast();

  const { data: leaguesResponse, isLoading: loadingLeagues } = useQuery<{ data: League[] }>({
    queryKey: ["/api/leagues"],
  });

  const leagues = leaguesResponse?.data;

  const { data: teamsResponse, isLoading: loadingTeams } = useQuery<{ data: Team[] }>({
    queryKey: ["/api/teams"],
  });

  const allTeams = teamsResponse?.data || [];

  // Get weekly scores for the first league (if any)
  const firstLeague = leagues?.[0];
  const currentWeek = firstLeague ? Math.ceil(differenceInWeeks(new Date(), new Date(firstLeague.seasonStart))) : 0;

  console.log('[LeaguesPage] First league and current week:', {
    firstLeague: firstLeague ? { 
      id: firstLeague.id, 
      name: firstLeague.name,
      seasonStart: firstLeague.seasonStart 
    } : null,
    currentWeek
  });

  const { data: scoresResponse, isLoading: loadingScores } = useQuery<{ data: ScoreWithRelations[] }>({
    queryKey: ["/api/scores/history", firstLeague?.id],
    queryFn: async () => {
      if (!firstLeague?.id) throw new Error("No league selected");
      const response = await fetch(`/api/scores?leagueId=${firstLeague.id}&weekNumber=${currentWeek}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to fetch scores');
      }
      return response.json();
    },
    enabled: !!firstLeague && currentWeek > 0,
  });

  const weeklyScores = scoresResponse?.data || [];

  console.log('[LeaguesPage] Weekly scores:', {
    responseData: scoresResponse?.data,
    scoresCount: weeklyScores.length
  });

  // Create a map of league ID to team count
  const teamCounts = allTeams.reduce((acc, team) => {
    acc[team.leagueId] = (acc[team.leagueId] || 0) + 1;
    return acc;
  }, {} as Record<number, number>);

  if (loadingLeagues || loadingTeams || loadingScores) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Leagues</h1>
        <Button onClick={() => {
          setSelectedLeague(undefined);
          setShowForm(true);
        }}>
          <Plus className="h-4 w-4 mr-2" />
          Add League
        </Button>
      </div>

      <div className="rounded-md border mb-8">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[15%]">Weekday</TableHead>
              <TableHead className="w-[25%]">Name</TableHead>
              <TableHead>Teams</TableHead>
              <TableHead className="w-[15%]">Start Date</TableHead>
              <TableHead className="w-[15%]">End Date</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leagues?.map((league) => {
              const startDate = new Date(league.seasonStart);
              const endDate = new Date(league.seasonEnd);
              const weeks = differenceInWeeks(endDate, startDate);
              const bowlingDay = league.weekDay ? league.weekDay.charAt(0).toUpperCase() + league.weekDay.slice(1) : 'Not set';

              return (
                <TableRow key={league.id}>
                  <TableCell>{bowlingDay}</TableCell>
                  <TableCell>
                    <Link 
                      href={`/leagues/${league.id}`}
                      className="text-foreground hover:underline font-medium"
                    >
                      {league.name}
                    </Link>
                  </TableCell>
                  <TableCell>{teamCounts[league.id] || 0}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {format(startDate, "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {format(endDate, "MMM d, yyyy")}
                  </TableCell>
                  <TableCell>{weeks} weeks</TableCell>
                  <TableCell>
                    <Badge variant={league.active ? "default" : "secondary"}>
                      {league.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedLeague(league);
                        setShowForm(true);
                      }}
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {weeklyScores.length > 0 && (
        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-4">Recent Scores</h2>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bowler</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Average</TableHead>
                  <TableHead>Handicap</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {weeklyScores.map((score) => (
                  <TableRow key={score.id}>
                    <TableCell>{score.bowler.name}</TableCell>
                    <TableCell>{score.team.name}</TableCell>
                    <TableCell>{score.score}</TableCell>
                    <TableCell>{score.average || 'N/A'}</TableCell>
                    <TableCell>{score.handicap}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <LeagueForm 
        open={showForm} 
        onClose={() => {
          setShowForm(false);
          setSelectedLeague(undefined);
        }}
        league={selectedLeague}
      />
    </Layout>
  );
}