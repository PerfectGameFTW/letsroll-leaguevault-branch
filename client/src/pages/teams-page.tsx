import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout";
import { ErrorBoundary } from "@/components/error-boundary";
import { TeamForm } from "@/components/team-form";
import { ReorderTeamsDialog } from "@/components/reorder-teams-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, ArrowLeft, ArrowUpDown } from "lucide-react";
import { PageLoadingState } from "@/components/page-states";
import type { Team, League } from "@shared/schema";
import { useParams, Link } from "wouter";

export default function TeamsPage() {
  const [showForm, setShowForm] = useState(false);
  const [showReorder, setShowReorder] = useState(false);
  const params = useParams();
  const leagueId = parseInt(params.leagueId!);

  const { data: leagueResponse, isLoading: loadingLeague } = useQuery<{ data: League }>({
    queryKey: [`/api/leagues/${leagueId}`],
    enabled: !!leagueId,
    retry: false,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  const league = leagueResponse?.data;

  const { data: teamsResponse, isLoading: loadingTeams } = useQuery<{ data: Team[] }>({
    queryKey: ["/api/teams", leagueId],
    queryFn: async () => {
      const response = await fetch(`/api/teams?leagueId=${leagueId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch teams');
      }
      return response.json();
    },
    enabled: !!leagueId,
    retry: false,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  const teams = teamsResponse?.data || [];
  const sortedTeams = teams
    .slice()
    .sort((a, b) => {
      if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
      const numA = a.number ?? Number.MAX_SAFE_INTEGER;
      const numB = b.number ?? Number.MAX_SAFE_INTEGER;
      return numA - numB;
    });

  if (loadingLeague || loadingTeams) {
    return (
      <Layout>
        <PageLoadingState />
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
      <ErrorBoundary level="section">
      <div className="space-y-4">
        <Link
          href="/leagues"
          className="text-muted-foreground hover:text-foreground flex items-center mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Leagues
        </Link>

        <div className="space-y-4 mb-6">
          <h1 className="text-2xl font-bold">{league.name}</h1>
          <div className="flex items-center gap-2">
            <Button onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Team
            </Button>
            {teams.length > 1 && (
              <Button variant="outline" onClick={() => setShowReorder(true)}>
                <ArrowUpDown className="h-4 w-4 mr-2" />
                Reorder Teams
              </Button>
            )}
          </div>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedTeams.map((team) => (
                <TableRow key={team.id}>
                  <TableCell>{team.number || 'Not assigned'}</TableCell>
                  <TableCell>
                    <Link href={`/teams/${team.id}`} className="hover:underline text-foreground">
                      {team.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={team.active ? "default" : "secondary"}>
                      {team.active ? "Active" : "Inactive"}
                    </Badge>
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

        <ReorderTeamsDialog
          open={showReorder}
          onClose={() => setShowReorder(false)}
          teams={sortedTeams}
          leagueId={leagueId}
        />
      </div>
      </ErrorBoundary>
    </Layout>
  );
}