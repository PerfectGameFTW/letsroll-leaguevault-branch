import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout";
import { BowlerForm } from "@/components/bowler-form";
import { AssignBowlerForm } from "@/components/assign-bowler-form";
import { ReorderBowlersDialog } from "@/components/reorder-bowlers-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Loader2, Plus, ArrowLeft, ExternalLink, Pencil, Trash2 } from "lucide-react";
import type { Team, Bowler, League, BowlerLeague } from "@shared/schema";
import { useParams, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const editTeamSchema = z.object({
  name: z.string().min(1, "Team name is required"),
});

interface ErrorBoundaryProps {
  error: Error;
}

function ErrorMessage({ error }: ErrorBoundaryProps) {
  return (
    <div className="p-4 rounded-md bg-destructive/10 text-destructive">
      <p className="font-medium">Error: {error.message}</p>
    </div>
  );
}

export default function TeamViewPage() {
  const [showForm, setShowForm] = useState(false);
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showReorderDialog, setShowReorderDialog] = useState(false);
  const [selectedBowler, setSelectedBowler] = useState<Bowler | undefined>();
  const [showRemoveDialog, setShowRemoveDialog] = useState<{ bowlerId: number; name: string } | null>(null);
  const { toast } = useToast();
  const params = useParams();
  const teamId = parseInt(params.teamId!);

  // Form for editing team name
  const editForm = useForm({
    resolver: zodResolver(editTeamSchema),
    defaultValues: {
      name: "",
    },
  });

  // Query for team data with proper error handling
  const { data: teamResponse, isLoading: loadingTeam, error: teamError } = useQuery({
    queryKey: [`/api/teams/${teamId}`],
    queryFn: async () => {
      console.log("[TeamView] Fetching team data for ID:", teamId);
      const response = await fetch(`/api/teams/${teamId}`);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to fetch team: ${text}`);
      }
      const data = await response.json();
      console.log("[TeamView] Team data received:", data);
      return data as { data: Team };
    },
  });

  const team = teamResponse?.data;

  // Get league info with proper error handling
  const { data: leagueResponse, isLoading: loadingLeague, error: leagueError } = useQuery({
    queryKey: [`/api/leagues/${team?.leagueId}`],
    queryFn: async () => {
      console.log("[TeamView] Fetching league data for ID:", team?.leagueId);
      if (!team?.leagueId) throw new Error('No league ID found');
      const response = await fetch(`/api/leagues/${team.leagueId}`);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to fetch league: ${text}`);
      }
      const data = await response.json();
      console.log("[TeamView] League data received:", data);
      return data as { data: League };
    },
    enabled: !!team?.leagueId,
  });

  const league = leagueResponse?.data;

  // Get bowler leagues for this team with proper error handling
  const { data: bowlerLeaguesResponse, isLoading: loadingBowlerLeagues, error: bowlerLeaguesError } = useQuery({
    queryKey: ["/api/bowler-leagues", teamId, team?.leagueId],
    queryFn: async () => {
      console.log("[TeamView] Fetching bowler leagues for team:", teamId, "league:", team?.leagueId);
      if (!team?.leagueId) throw new Error('No league ID found');
      const response = await fetch(`/api/bowler-leagues?teamId=${teamId}&leagueId=${team.leagueId}`);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to fetch bowler leagues: ${text}`);
      }
      const data = await response.json();
      console.log("[TeamView] Bowler leagues received:", data);
      return data as { data: BowlerLeague[] };
    },
    enabled: !!team?.leagueId,
    retry: false,
  });

  const bowlerLeagues = bowlerLeaguesResponse?.data || [];

  // Get bowlers data with proper error handling
  const bowlerIds = bowlerLeagues.map(bl => bl.bowlerId);
  const { data: bowlersResponse, isLoading: loadingBowlers, error: bowlersError } = useQuery({
    queryKey: ["/api/bowlers", bowlerIds],
    queryFn: async () => {
      console.log("[TeamView] Fetching bowlers for IDs:", bowlerIds);
      if (!bowlerIds.length) return { data: [] };
      const response = await fetch(`/api/bowlers?ids=${bowlerIds.join(",")}`);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Failed to fetch bowlers: ${text}`);
      }
      const data = await response.json();
      console.log("[TeamView] Bowlers data received:", data);
      return data as { data: Bowler[] };
    },
    enabled: bowlerIds.length > 0,
    retry: false,
  });

  const bowlers = bowlersResponse?.data || [];

  // Create team bowlers array with proper ordering
  const teamBowlers = bowlerLeagues
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(bl => ({
      bowler: bowlers.find(b => b.id === bl.bowlerId),
      bowlerLeague: bl,
    }))
    .filter((item): item is { bowler: Bowler; bowlerLeague: BowlerLeague } => {
      return !!item.bowler;
    });

  console.log("[TeamView] Final team bowlers array:", teamBowlers);

  const updateTeamMutation = useMutation({
    mutationFn: async (values: z.infer<typeof editTeamSchema>) => {
      const response = await apiRequest("PATCH", `/api/teams/${teamId}`, values);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text);
      }
      return response.json();
    },
    onSuccess: (updatedTeam) => {
      queryClient.setQueryData([`/api/teams/${teamId}`], { data: updatedTeam });
      setShowEditDialog(false);
      toast({
        title: "Team updated",
        description: "Team name has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error updating team",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const removeBowlerMutation = useMutation({
    mutationFn: async ({ bowlerId }: { bowlerId: number }) => {
      const bowlerLeague = bowlerLeagues.find(bl =>
        bl.bowlerId === bowlerId &&
        bl.teamId === teamId &&
        bl.leagueId === team?.leagueId
      );

      if (!bowlerLeague) {
        throw new Error("Bowler league association not found");
      }

      const response = await apiRequest(
        "DELETE",
        `/api/bowler-leagues/${bowlerLeague.id}`
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bowler-leagues"] });
      setShowRemoveDialog(null);
      toast({
        title: "Bowler removed",
        description: "Bowler has been removed from the team.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error removing bowler",
        description: error.message,
        variant: "destructive",
      });
    },
  });


  const handleEditClick = () => {
    if (team) {
      editForm.reset({ name: team.name });
      setShowEditDialog(true);
    }
  };

  const onEditTeam = (values: z.infer<typeof editTeamSchema>) => {
    updateTeamMutation.mutate(values);
  };

  const handleRemoveBowler = async () => {
    if (!showRemoveDialog) return;
    await removeBowlerMutation.mutate({ bowlerId: showRemoveDialog.bowlerId });
  };

  // Handle errors
  if (teamError) return <Layout><ErrorMessage error={teamError} /></Layout>;

  // Handle loading states
  const isLoading = loadingTeam || loadingBowlers || loadingBowlerLeagues || loadingLeague;
  if (isLoading) {
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
        <div className="text-center text-destructive">Team not found</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <Link
          href={`/leagues/${team.leagueId}/teams`}
          className="text-muted-foreground hover:text-foreground flex items-center mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Teams
        </Link>
        <div className="flex flex-col gap-4 mb-6">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold flex-1">{team.name}</h1>
            <Button variant="ghost" size="sm" onClick={handleEditClick}>
              <Pencil className="h-4 w-4" />
              <span className="sr-only">Edit team name</span>
            </Button>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create New Bowler
            </Button>
            <Button onClick={() => setShowAssignForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Existing Bowler
            </Button>
          </div>
        </div>
      </div>

      {/* Show any fetch errors */}
      {(leagueError || bowlerLeaguesError || bowlersError) && (
        <div className="mb-4">
          {leagueError && <ErrorMessage error={leagueError} />}
          {bowlerLeaguesError && <ErrorMessage error={bowlerLeaguesError} />}
          {bowlersError && <ErrorMessage error={bowlersError} />}
        </div>
      )}

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
            {teamBowlers.length > 0 ? (
              teamBowlers.map(({ bowler, bowlerLeague }) => (
                <TableRow key={bowlerLeague.id}>
                  <TableCell>
                    <Link href={`/bowlers/${bowler.id}`} className="hover:underline">
                      {bowler.name}
                    </Link>
                  </TableCell>
                  <TableCell>{bowler.email}</TableCell>
                  <TableCell>${((league?.weeklyFee || 0) / 100).toFixed(2)}</TableCell>
                  <TableCell>
                    <Badge variant={bowlerLeague.active ? "default" : "secondary"}>
                      {bowlerLeague.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedBowler(bowler);
                          setShowForm(true);
                        }}
                      >
                        <Pencil className="h-4 w-4 mr-2" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowRemoveDialog({ bowlerId: bowler.id, name: bowler.name })}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Remove
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="text-center">
                  No bowlers assigned to this team
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {teamBowlers.length > 1 && (
        <div className="mt-4">
          <Button variant="outline" onClick={() => setShowReorderDialog(true)}>
            Reorder Bowlers
          </Button>
        </div>
      )}

      {/* Edit Team Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Team Name</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditTeam)} className="space-y-4">
              <FormField
                control={editForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input placeholder="Enter team name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end">
                <Button type="submit" disabled={updateTeamMutation.isPending}>
                  {updateTeamMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Bowler Forms */}
      <BowlerForm
        open={showForm}
        onClose={() => {
          setShowForm(false);
          setSelectedBowler(undefined);
        }}
        defaultTeamId={teamId}
        bowler={selectedBowler}
      />

      <AssignBowlerForm
        open={showAssignForm}
        onClose={() => setShowAssignForm(false)}
        teamId={teamId}
        leagueId={team.leagueId}
      />

      <ReorderBowlersDialog
        open={showReorderDialog}
        onClose={() => setShowReorderDialog(false)}
        bowlers={bowlers}
        bowlerLeagues={bowlerLeagues}
        teamId={teamId}
        leagueId={team.leagueId}
      />

      {/* Remove Bowler Confirmation Dialog */}
      <Dialog open={showRemoveDialog !== null} onOpenChange={(open) => !open && setShowRemoveDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Bowler from Team</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove {showRemoveDialog?.name} from this team? This will completely remove their association with this team.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowRemoveDialog(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRemoveBowler}
              disabled={removeBowlerMutation.isPending}
            >
              {removeBowlerMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}