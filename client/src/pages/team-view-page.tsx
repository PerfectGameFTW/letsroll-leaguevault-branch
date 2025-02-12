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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Loader2, Plus, ArrowLeft, ExternalLink, Pencil } from "lucide-react";
import type { Team, Bowler, League, BowlerLeague } from "@shared/schema";
import { getSquareCustomerUrl } from "@/lib/square";
import { useParams, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface SortableBowlerRowProps {
  bowler: Bowler;
  bowlerLeague: BowlerLeague;
  league: League | undefined;
  onEdit: (bowler: Bowler) => void;
}

function SortableBowlerRow({ bowler, bowlerLeague, league, onEdit }: SortableBowlerRowProps) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <Link href={`/bowlers/${bowler.id}`} className="hover:underline">
            {bowler.name}
          </Link>
        </div>
      </TableCell>
      <TableCell>{bowler.email}</TableCell>
      <TableCell>${((league?.weeklyFee || 0) / 100).toFixed(2)}</TableCell>
      <TableCell>
        <Badge variant={bowlerLeague.active ? "default" : "secondary"}>
          {bowlerLeague.active ? "Active" : "Inactive"}
        </Badge>
      </TableCell>
      <TableCell>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onEdit(bowler)}
        >
          <Pencil className="h-4 w-4 mr-2" />
          Edit
        </Button>
      </TableCell>
    </TableRow>
  );
}

const editTeamSchema = z.object({
  name: z.string().min(1, "Team name is required"),
});

export default function TeamViewPage() {
  const [showForm, setShowForm] = useState(false);
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showReorderDialog, setShowReorderDialog] = useState(false);
  const [selectedBowler, setSelectedBowler] = useState<Bowler | undefined>();
  const { toast } = useToast();
  const params = useParams();
  const teamId = parseInt(params.teamId!);

  const editForm = useForm({
    resolver: zodResolver(editTeamSchema),
    defaultValues: {
      name: "",
    },
  });

  const { data: teamResponse, isLoading: loadingTeam } = useQuery<{ data: Team }>({
    queryKey: [`/api/teams/${teamId}`],
  });
  const team = teamResponse?.data;

  const { data: bowlerLeaguesResponse, isLoading: loadingBowlerLeagues } = useQuery<{ data: BowlerLeague[] }>({
    queryKey: ["/api/bowler-leagues", { teamId, leagueId: team?.leagueId }],
    queryFn: async () => {
      if (!team?.leagueId) {
        return { data: [] };
      }
      const response = await fetch(`/api/bowler-leagues?teamId=${teamId}&leagueId=${team.leagueId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch bowler leagues');
      }
      return response.json();
    },
    enabled: !!team?.leagueId,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    // refetchInterval: 1000, 
  });

  const bowlerLeagues = bowlerLeaguesResponse?.data || [];
  const sortedBowlerLeagues = [...bowlerLeagues].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const { data: bowlersResponse, isLoading: loadingBowlers } = useQuery<{ data: Bowler[] }>({
    queryKey: ["/api/bowlers", sortedBowlerLeagues],
    queryFn: async () => {
      if (!sortedBowlerLeagues.length) {
        return { data: [] };
      }
      const bowlerIds = sortedBowlerLeagues.map(bl => bl.bowlerId);
      const response = await fetch(`/api/bowlers?ids=${bowlerIds.join(",")}`);
      if (!response.ok) {
        throw new Error('Failed to fetch bowlers');
      }
      return response.json();
    },
    enabled: sortedBowlerLeagues.length > 0,
    staleTime: 30000, // Cache results for 30 seconds
    refetchOnWindowFocus: false,
  });

  const bowlers = bowlersResponse?.data ?? [];

  // Ensure bowlers are ordered according to sortedBowlerLeagues
  const teamBowlers = sortedBowlerLeagues
    .map(bl => bowlers.find(b => b.id === bl.bowlerId))
    .filter((bowler): bowler is Bowler => {
      return bowler !== undefined && 
        typeof bowler === 'object' && 
        'id' in bowler;
    });

  const { data: leagueResponse, isLoading: loadingLeague } = useQuery<{ data: League }>({
    queryKey: [`/api/leagues/${team?.leagueId}`],
    enabled: !!team?.leagueId,
  });

  const league = leagueResponse?.data;

  const reorderMutation = useMutation({
    mutationFn: async ({ id, order }: { id: number; order: number }) => {
      console.log("Attempting to reorder bowler league:", { id, order });
      const response = await apiRequest("PATCH", `/api/bowler-leagues/${id}`, { order });
      if (!response.ok) {
        const errorText = await response.text();
        console.error("Reorder mutation failed:", errorText);
        throw new Error(errorText || "Failed to reorder bowlers");
      }
      return response.json();
    },
    onSuccess: (response) => {
      console.log("Successfully reordered bowler league:", response);
      queryClient.invalidateQueries({ 
        queryKey: ["/api/bowler-leagues", { teamId, leagueId: team?.leagueId }] 
      });

      toast({
        title: "Success",
        description: "Bowler order updated successfully",
      });
    },
    onError: (error: Error) => {
      console.error("Error in reorder mutation:", error);
      toast({
        title: "Error reordering bowlers",
        description: error.message || "Failed to update bowler order",
        variant: "destructive",
      });
    }
  });

  const updateTeamMutation = useMutation({
    mutationFn: async (values: z.infer<typeof editTeamSchema>) => {
      const response = await apiRequest("PATCH", `/api/teams/${teamId}`, values);
      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
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

  const onEditTeam = (values: z.infer<typeof editTeamSchema>) => {
    updateTeamMutation.mutate(values);
  };

  const handleEditClick = () => {
    if (team) {
      editForm.reset({ name: team.name });
      setShowEditDialog(true);
    }
  };

  if (loadingTeam || loadingBowlers || loadingBowlerLeagues || loadingLeague) {
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
              <TableHead>Email</TableHead>
              <TableHead>Weekly Fee</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loadingBowlerLeagues && !loadingBowlers ? (
              Array.isArray(sortedBowlerLeagues) && sortedBowlerLeagues.length > 0 ? (
                sortedBowlerLeagues.map((bowlerLeague) => {
                  const bowler = teamBowlers.find(b => b.id === bowlerLeague.bowlerId);
                  if (!bowler) return null;
                  return (
                    <SortableBowlerRow
                      key={bowlerLeague.id}
                      bowler={bowler}
                      bowlerLeague={bowlerLeague}
                      league={league}
                      onEdit={(b) => {
                        setSelectedBowler(b);
                        setShowForm(true);
                      }}
                    />
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center">
                    No bowlers assigned to this team
                  </TableCell>
                </TableRow>
              )
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="text-center">
                  <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {sortedBowlerLeagues.length > 1 && (
        <div className="mt-4">
          <Button variant="outline" onClick={() => setShowReorderDialog(true)}>
            Reorder Bowlers
          </Button>
        </div>
      )}

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
        bowlers={teamBowlers}
        bowlerLeagues={sortedBowlerLeagues}
        teamId={teamId}
        leagueId={team?.leagueId}
      />
    </Layout>
  );
}