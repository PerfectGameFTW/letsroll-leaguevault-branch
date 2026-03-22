import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Layout } from "@/components/layout";
import { BowlerForm } from "@/components/bowler-form";
import { ErrorBoundary } from "@/components/error-boundary";
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
import { Loader2, Plus, ArrowLeft, Pencil, Trash2, CheckCircle2 } from "lucide-react";
import { PageLoadingState, PageErrorState } from "@/components/page-states";
import type { Team, Bowler, League, BowlerLeague, ApiResponse, TeamDetailsResponse } from "@shared/schema";
import { useParams, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getTeamBowlers } from "@/lib/bowler-league-utils";

const editTeamSchema = z.object({
  name: z.string().min(1, "Team name is required"),
});

export default function TeamViewPage() {
  const [showForm, setShowForm] = useState(false);
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showReorderDialog, setShowReorderDialog] = useState(false);
  const [selectedBowler, setSelectedBowler] = useState<Bowler | undefined>();
  const [showRemoveDialog, setShowRemoveDialog] = useState<{ bowlerId: number; name: string } | null>(null);
  const { toast } = useToast();
  const params = useParams();
  const teamId = params.teamId ? parseInt(params.teamId) : undefined;

  // Form for editing team name
  const editForm = useForm({
    resolver: zodResolver(editTeamSchema),
    defaultValues: {
      name: "",
    },
  });

  const { data: detailsResponse, isLoading: loadingDetails, error: detailsError, refetch: refetchDetails } = useQuery<ApiResponse<TeamDetailsResponse>>({
    queryKey: [`/api/teams/${teamId}/details`],
    enabled: !!teamId,
    retry: false,
  });

  const team = detailsResponse?.data?.team;
  const league = detailsResponse?.data?.league;
  const bowlerLeagues = detailsResponse?.data?.bowlerLeagues || [];
  const bowlers = detailsResponse?.data?.bowlers || [];

  const teamBowlers = useMemo(
    () => getTeamBowlers(bowlerLeagues, bowlers, teamId),
    [bowlerLeagues, bowlers, teamId]
  );

  const updateTeamMutation = useMutation({
    mutationFn: async (values: z.infer<typeof editTeamSchema>) => {
      if (!teamId) throw new Error("No team ID provided");
      const response = await apiRequest(`/api/teams/${teamId}`, "PATCH", values);
      if (!response.success) {
        throw new Error(response.error?.message || "Failed to update team");
      }
      return response.data;
    },
    onSuccess: (updatedTeam) => {
      queryClient.invalidateQueries({ queryKey: [`/api/teams/${teamId}/details`] });
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
      const bowlerLeague = bowlerLeagues.find((bl: BowlerLeague) =>
        bl.bowlerId === bowlerId &&
        bl.teamId === teamId &&
        bl.leagueId === team?.leagueId &&
        bl.active
      );

      if (!bowlerLeague) {
        throw new Error("Bowler league association not found");
      }

      return await apiRequest(
        `/api/bowler-leagues/${bowlerLeague.id}`,
        "DELETE"
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/teams/${teamId}/details`] });
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

  if (!teamId) {
    return (
      <Layout>
        <div className="text-center text-destructive">Invalid team ID</div>
      </Layout>
    );
  }

  // Handle loading states with proper error display
  if (detailsError) {
    return (
      <Layout>
        <PageErrorState message={`Error loading team: ${detailsError.message}`} onRetry={() => refetchDetails()} />
      </Layout>
    );
  }

  if (loadingDetails) {
    return (
      <Layout>
        <PageLoadingState />
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
      <ErrorBoundary level="section">
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


      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
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
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className={`h-4 w-4 ${(bowler as any).hasAccount ? "text-green-500" : "text-muted-foreground/40"}`} />
                      <Link href={`/bowlers/${bowler.id}`} className="hover:underline">
                        {bowler.name}
                      </Link>
                    </div>
                  </TableCell>
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
                <TableCell colSpan={4} className="text-center">
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
        leagueId={team?.leagueId}
      />

      <ReorderBowlersDialog
        open={showReorderDialog}
        onClose={() => setShowReorderDialog(false)}
        bowlers={bowlers}
        bowlerLeagues={bowlerLeagues}
        teamId={teamId}
        leagueId={team?.leagueId}
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
      </ErrorBoundary>
    </Layout>
  );
}