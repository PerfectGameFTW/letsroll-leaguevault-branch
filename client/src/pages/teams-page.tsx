import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout";
import { TeamForm } from "@/components/team-form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Users } from "lucide-react";
import type { Team, League, Bowler } from "@shared/schema"; // Added Bowler type
import { useParams, Link } from "wouter";

export default function TeamsPage() {
  const [showForm, setShowForm] = useState(false);
  const params = useParams();
  const leagueId = parseInt(params.leagueId!);

  const { data: league, isLoading: loadingLeague } = useQuery<League>({
    queryKey: [`/api/leagues/${leagueId}`],
  });

  const { data: teamsResponse, isLoading: loadingTeams } = useQuery<{ data: Team[] }>({
    queryKey: ["/api/teams", leagueId],
    queryFn: async () => {
      const response = await fetch(`/api/teams?leagueId=${leagueId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch teams');
      }
      return response.json();
    }
  });

  const teams = teamsResponse?.data;
  const sortedTeams = useMemo(() => {
    return teams?.slice().sort((a, b) => (a.number || 0) - (b.number || 0)) ?? [];
  }, [teams]);

  if (loadingLeague || loadingTeams) {
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
        <div className="text-center">League not found</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4 mb-6">
        <h1 className="text-2xl font-bold">{league.name}</h1>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Team
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedTeams.map((team) => (
              <TableRow key={team.id}>
                <TableCell>{team.number}</TableCell>
                <TableCell>{team.name}</TableCell>
                <TableCell>
                  <Badge variant={team.active ? "default" : "secondary"}>
                    {team.active ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <TeamBowlers teamId={team.id} /> {/*Added component to display bowlers */}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <TeamForm
        open={showForm}
        onClose={() => setShowForm(false)}
        leagueId={leagueId}
      />
    </Layout>
  );
}

function TeamBowlers({ teamId }: { teamId: number }) {
  const params = useParams();
  const leagueId = parseInt(params.leagueId!);
  
  const { data: bowlerLeaguesResponse, isLoading } = useQuery<{ data: BowlerLeague[] }>({
    queryKey: [`/api/bowler-leagues`, teamId, leagueId],
    queryFn: async () => {
      const response = await fetch(`/api/bowler-leagues?teamId=${teamId}&leagueId=${leagueId}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch bowler leagues for team ${teamId}`);
      }
      return response.json();
    },
    enabled: !!teamId && !!leagueId,
  });

  const bowlerLeagues = bowlerLeaguesResponse?.data || [];

  

  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin" />;

  return (
    <>
      <Button variant="outline" size="sm" asChild>
        <Link href={`/teams/${teamId}`}>
          <Users className="h-4 w-4 mr-2" />
          View Team ({bowlerLeagues?.length || 0} Bowlers)
        </Link>
      </Button>
    </>
  );
}