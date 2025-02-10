import { useState, useEffect } from "react";
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

// Remove SortableBowlerRow component as we're no longer using DnD

const editTeamSchema = z.object({
  name: z.string().min(1, "Team name is required"),
});

function BowlerRow({ 
  bowler, 
  bowlerLeague, 
  league, 
  onEdit,
  onUpdateOrder 
}: {
  bowler: Bowler;
  bowlerLeague: BowlerLeague;
  league: League | undefined;
  onEdit: (bowler: Bowler) => void;
  onUpdateOrder: (id: number, order: number) => void;
}) {
  return (
    <TableRow>
      <TableCell>
        <Input
          type="number"
          min={0}
          value={bowlerLeague.order || 0}
          onChange={(e) => {
            const newOrder = parseInt(e.target.value);
            if (!isNaN(newOrder) && newOrder >= 0) {
              onUpdateOrder(bowlerLeague.id, newOrder);
            }
          }}
          className="w-20"
        />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Link href={`/bowlers/${bowler.id}`} className="hover:underline">
            {bowler.name}
          </Link>
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

export default function TeamViewPage() {
  const [showForm, setShowForm] = useState(false);
  const [showAssignForm, setShowAssignForm] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
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

  const { data: bowlerLeaguesResponse, isLoading: loadingBowlerLeagues, error: bowlerLeaguesError } = useQuery<{ data: BowlerLeague[] }>({
    queryKey: ["/api/bowler-leagues", teamId, team?.leagueId],
    queryFn: async () => {
      const response = await fetch(`/api/bowler-leagues?teamId=${teamId}&leagueId=${team?.leagueId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch bowler leagues');
      }
      return response.json();
    },
    enabled: !!team?.leagueId,
  });

  // Ensure we have a valid array before sorting
  const sortedBowlerLeagues = bowlerLeaguesResponse?.data 
    ? [...bowlerLeaguesResponse.data].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : [];

  const { data: bowlersResponse, isLoading: loadingBowlers } = useQuery<{ data: Bowler[] }>({
    queryKey: ["/api/bowlers", sortedBowlerLeagues],
    queryFn: async () => {
      if (!sortedBowlerLeagues.length) {
        return { data: [] };
      }
      const bowlerIds = sortedBowlerLeagues.map((bl) => bl.bowlerId);
      const response = await fetch(`/api/bowlers?ids=${bowlerIds.join(",")}`);
      if (!response.ok) {
        throw new Error("Failed to fetch bowlers");
      }
      return response.json();
    },
    enabled: sortedBowlerLeagues.length > 0,
  });

  const bowlers = bowlersResponse?.data || [];

  const teamBowlers = bowlers.filter((bowler): bowler is Bowler => {
    if (!bowler || typeof bowler !== 'object' || !('id' in bowler)) {
      return false;
    }
    return sortedBowlerLeagues.some((bl) =>
      bl.bowlerId === bowler.id &&
      bl.teamId === teamId &&
      bl.leagueId === team?.leagueId
    );
  });

  const { data: leagueResponse, isLoading: loadingLeague } = useQuery<{ data: League }>({
    queryKey: [`/api/leagues/${team?.leagueId}`],
    enabled: !!team?.leagueId,
  });

  useEffect(() => {
    if (bowlerLeaguesError) {
      toast({
        title: "Error loading bowler leagues",
        description: bowlerLeaguesError instanceof Error ? bowlerLeaguesError.message : "An unknown error occurred",
        variant: "destructive",
      });
    }
  }, [bowlerLeaguesError, toast]);

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
      queryClient.setQueryData([`/api/teams/${teamId}`], updatedTeam);
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

  const reorderMutation = useMutation({
    mutationFn: async ({ id, order }: { id: number; order: number }) => {
      const response = await apiRequest("PATCH", `/api/bowler-leagues/${id}`, { order });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }
      return response.json();
    },
    onSuccess: (updatedData) => {
      queryClient.setQueryData(["/api/bowler-leagues", teamId, team?.leagueId], {
        success: true,
        data: updatedData
      });
      queryClient.invalidateQueries({ queryKey: ["/api/bowler-leagues"] });
    }
  });

  const handleUpdateOrder = (id: number, newOrder: number) => {
    reorderMutation.mutate({ id, order: newOrder });
  };

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

  const league = leagueResponse?.data;

  return (
    <Layout>
      <div className="mb-6">
        <Link href={`/leagues/${team.leagueId}/teams`} className="text-muted-foreground hover:text-foreground flex items-center mb-4">
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
              <TableHead>Order</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Weekly Fee</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loadingBowlerLeagues && !loadingBowlers ? (
              teamBowlers?.length > 0 ? (
                teamBowlers.map((bowler) => {
                  const bowlerLeague = sortedBowlerLeagues.find((bl) => bl.bowlerId === bowler.id);
                  if (!bowlerLeague) return null;
                  return (
                    <BowlerRow
                      key={bowlerLeague.id}
                      bowler={bowler}
                      bowlerLeague={bowlerLeague}
                      league={league}
                      onEdit={(b) => {
                        setSelectedBowler(b);
                        setShowForm(true);
                      }}
                      onUpdateOrder={handleUpdateOrder}
                    />
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center">
                    No bowlers assigned to this team
                  </TableCell>
                </TableRow>
              )
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center">
                  <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

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
        leagueId={team.leagueId}
      />
    </Layout>
  );
}