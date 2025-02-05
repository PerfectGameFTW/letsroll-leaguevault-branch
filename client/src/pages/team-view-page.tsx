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
import { Loader2, Plus, ArrowLeft, ExternalLink, UserPlus, Pencil, GripVertical } from "lucide-react";
import type { Team, Bowler } from "@shared/schema";
import { getSquareCustomerUrl } from "@/lib/square";
import { useParams, Link } from "wouter";
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
  onEdit: (bowler: Bowler) => void;
}

function SortableBowlerRow({ bowler, onEdit }: SortableBowlerRowProps) {
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
  const [selectedBowler, setSelectedBowler] = useState<Bowler | undefined>();
  const { toast } = useToast();
  const params = useParams();
  const teamId = parseInt(params.teamId!);

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
    queryFn: () =>
      fetch(`/api/bowlers?teamId=${teamId}`).then((res) => res.json()),
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
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["/api/bowlers", teamId] });

      // Get snapshot of current data
      const previousBowlers = queryClient.getQueryData<Bowler[]>(["/api/bowlers", teamId]);

      // Optimistically update the cache
      if (previousBowlers) {
        const bowlers = [...previousBowlers];
        const oldIndex = bowlers.findIndex(b => b.id === id);
        if (oldIndex !== -1) {
          const [movedBowler] = bowlers.splice(oldIndex, 1);
          bowlers.splice(order, 0, movedBowler);
          // Update all orders to match array indices
          bowlers.forEach((b, index) => {
            b.order = index;
          });
          queryClient.setQueryData(["/api/bowlers", teamId], bowlers);
        }
      }

      return { previousBowlers };
    },
    onError: (error: Error, _, context) => {
      // Revert to previous state on error
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
      // Update cache with the server response
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

  // Sort bowlers by order
  const sortedBowlers = bowlers?.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return (
    <Layout>
      <div className="mb-6">
        <Link href={`/leagues/${team.leagueId}/teams`} className="text-muted-foreground hover:text-foreground flex items-center mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Teams
        </Link>
        <div className="flex flex-col gap-4 mb-6">
          <h1 className="text-2xl font-bold">Team {team.number}: {team.name}</h1>
          <div className="flex gap-2">
            <Button onClick={() => setShowAssignForm(true)}>
              <UserPlus className="h-4 w-4 mr-2" />
              Add Existing Bowler
            </Button>
            <Button onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create New Bowler
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