import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout";
import { BowlerForm } from "@/components/bowler-form";
import { AssignBowlerForm } from "@/components/assign-bowler-form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, ArrowLeft, ExternalLink, UserPlus } from "lucide-react";
import type { Team, Bowler } from "@shared/schema";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useParams, Link } from "wouter";
import { getSquareCustomerUrl } from "@/lib/square";

export default function TeamViewPage() {
  const [showForm, setShowForm] = useState(false);
  const [showAssignForm, setShowAssignForm] = useState(false);
  const { toast } = useToast();
  const params = useParams();
  const teamId = parseInt(params.teamId!);

  const { data: team, isLoading: loadingTeam } = useQuery<Team>({
    queryKey: [`/api/teams/${teamId}`],
  });

  const { data: bowlers, isLoading: loadingBowlers } = useQuery<Bowler[]>({
    queryKey: ["/api/bowlers", teamId],
    queryFn: () => 
      fetch(`/api/bowlers?teamId=${teamId}`).then(res => res.json()),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/bowlers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bowlers", teamId] });
      toast({
        title: "Bowler deleted",
        description: "The bowler has been removed from the team.",
      });
    },
  });

  if (loadingTeam || loadingBowlers) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  if (!team) {
    return (
      <Layout>
        <div className="text-center">Team not found</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <Link href={`/leagues/${team.leagueId}/teams`} className="text-muted-foreground hover:text-foreground flex items-center mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Teams
        </Link>
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">Team {team.number}: {team.name}</h1>
            <p className="text-muted-foreground">Manage team members</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setShowAssignForm(true)}>
              <UserPlus className="h-4 w-4 mr-2" />
              Add Existing Bowler
            </Button>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Bowler
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Weekly Fee</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bowlers?.map((bowler) => (
              <TableRow key={bowler.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {bowler.name}
                    {bowler.squareCustomerId && (
                      <a
                        href={getSquareCustomerUrl(bowler.squareCustomerId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                        title="View in Square"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </TableCell>
                <TableCell>{bowler.email}</TableCell>
                <TableCell>${(bowler.weeklyFee / 100).toFixed(2)}</TableCell>
                <TableCell>
                  <Badge variant={bowler.active ? "default" : "secondary"}>
                    {bowler.active ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteMutation.mutate(bowler.id)}
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <BowlerForm 
        open={showForm} 
        onClose={() => setShowForm(false)} 
        defaultTeamId={teamId}
      />

      <AssignBowlerForm
        open={showAssignForm}
        onClose={() => setShowAssignForm(false)}
        teamId={teamId}
        leagueId={team.leagueId}
      />
    </Layout>
  );
}