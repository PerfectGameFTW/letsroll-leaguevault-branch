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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Loader2, Plus, ArrowLeft, ExternalLink, Pencil, GripVertical } from "lucide-react";
import type { Team, Bowler, League } from "@shared/schema"; // Added League import
import { getSquareCustomerUrl } from "@/lib/square";
import { useParams, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface SortableBowlerRowProps {
  bowler: Bowler;
  league: League | undefined;
  onEdit: (bowler: Bowler) => void;
}

function SortableBowlerRow({ bowler, league, onEdit }: SortableBowlerRowProps) {
  const {
    attributes,
    listeners,
    transform,
    transition,
    setNodeRef,
  } = useSortable({ id: bowler.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <TableRow ref={setNodeRef} style={style}>
      <TableCell>
        <Button
          variant="ghost"
          size="sm"
          className="p-0 cursor-grab active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </Button>
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
        <Badge variant={bowler.active ? "default" : "secondary"}>
          {bowler.active ? "Active" : "Inactive"}
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

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const { data: team, isLoading: loadingTeam } = useQuery<Team>({
    queryKey: [`/api/teams/${teamId}`],
  });

  const { data: bowlers, isLoading: loadingBowlers } = useQuery<Bowler[]>({
    queryKey: ["/api/bowlers", teamId],
    queryFn: async () => {
      const response = await fetch(`/api/teams/${teamId}/bowlers`);
      if (!response.ok) {
        throw new Error('Failed to fetch bowlers');
      }
      return response.json();
    },
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
      const response = await apiRequest("PATCH", `/api/bowlers/${id}`, { order });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }
      return response.json();
    },
    onMutate: async ({ id, order }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/bowlers", teamId] });
      const previousBowlers = queryClient.getQueryData<Bowler[]>(["/api/bowlers", teamId]);
      if (previousBowlers) {
        const bowlers = [...previousBowlers];
        const oldIndex = bowlers.findIndex(b => b.id === id);
        if (oldIndex !== -1) {
          const [movedBowler] = bowlers.splice(oldIndex, 1);
          bowlers.splice(order, 0, movedBowler);
          bowlers.forEach((b, index) => {
            b.order = index;
          });
          queryClient.setQueryData(["/api/bowlers", teamId], bowlers);
        }
      }
      return { previousBowlers };
    },
    onError: (error: Error, _, context) => {
      if (context?.previousBowlers) {
        queryClient.setQueryData(["/api/bowlers", teamId], context.previousBowlers);
      }
      toast({
        title: "Error reordering bowlers",
        description: error.message,
        variant: "destructive",
      });
    },
    onSuccess: (updatedBowlers) => {
      queryClient.setQueryData(["/api/bowlers", teamId], updatedBowlers);
    },
  });

  const handleDragEnd = async (event: any) => {
    const { active, over } = event;

    if (active.id !== over.id && bowlers) {
      const oldIndex = bowlers.findIndex((b) => b.id === active.id);
      const newIndex = bowlers.findIndex((b) => b.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        await reorderMutation.mutateAsync({
          id: active.id,
          order: newIndex,
        });
      }
    }
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

  const { data: league, isLoading: loadingLeague } = useQuery<League>({
    queryKey: [`/api/leagues/${team?.leagueId}`],
    enabled: !!team?.leagueId, // Only run if team and leagueId exist
  });


  if (loadingTeam || loadingBowlers || loadingLeague) {
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

  const sortedBowlers = bowlers?.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

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
              <TableHead className="w-[50px]"></TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Weekly Fee</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sortedBowlers?.map((b) => b.id) ?? []}
                strategy={verticalListSortingStrategy}
              >
                {sortedBowlers?.map((bowler) => (
                  <SortableBowlerRow
                    key={bowler.id}
                    bowler={bowler}
                    league={league}
                    onEdit={(b) => {
                      setSelectedBowler(b);
                      setShowForm(true);
                    }}
                  />
                ))}
              </SortableContext>
            </DndContext>
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