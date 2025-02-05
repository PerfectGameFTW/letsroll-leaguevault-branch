import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useParams, Link } from "wouter";

export default function TeamsPage() {
  const [showForm, setShowForm] = useState(false);
  const { toast } = useToast();
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

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/teams/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/teams", leagueId] });
      toast({
        title: "Team deleted",
        description: "The team has been removed from the league.",
      });
    },
  });

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
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">{league.name} Teams</h1>
          <p className="text-muted-foreground">{league.description}</p>
        </div>
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
                  <div className="flex gap-2">
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
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => deleteMutation.mutate(team.id)}
                    >
                      Delete
                    </Button>
                  </div>
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