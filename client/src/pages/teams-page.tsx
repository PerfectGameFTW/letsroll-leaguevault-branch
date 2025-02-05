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
import type { Team, League } from "@shared/schema";
import { useParams, Link } from "wouter";

export default function TeamsPage() {
  const [showForm, setShowForm] = useState(false);
  const params = useParams();
  const leagueId = parseInt(params.leagueId!);

  const { data: league, isLoading: loadingLeague } = useQuery<League>({
    queryKey: [`/api/leagues/${leagueId}`],
  });

  const { data: teams, isLoading: loadingTeams } = useQuery<Team[]>({
    queryKey: ["/api/teams", leagueId],
    queryFn: () =>
      fetch(`/api/teams?leagueId=${leagueId}`).then((res) => res.json()),
  });

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
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                  >
                    <Link href={`/teams/${team.id}`}>
                      <Users className="h-4 w-4 mr-2" />
                      View Team
                    </Link>
                  </Button>
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