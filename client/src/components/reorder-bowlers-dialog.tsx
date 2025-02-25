import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, ArrowUp, ArrowDown } from "lucide-react";
import type { Bowler, BowlerLeague } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface ReorderBowlersDialogProps {
  open: boolean;
  onClose: () => void;
  bowlers: Bowler[];
  bowlerLeagues: BowlerLeague[];
  teamId: number;
  leagueId: number;
}

export function ReorderBowlersDialog({
  open,
  onClose,
  bowlers,
  bowlerLeagues,
  teamId,
  leagueId,
}: ReorderBowlersDialogProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filter bowlerLeagues to only include active bowlers from this team
  const teamBowlerLeagues = bowlerLeagues.filter(bl => 
    bl.teamId === teamId && 
    bl.leagueId === leagueId && 
    bl.active
  );

  // Get list of bowler IDs that are on this team
  const teamBowlerIds = teamBowlerLeagues.map(bl => bl.bowlerId);

  // Filter bowlers to only include those on this team
  const teamBowlers = bowlers.filter(b => teamBowlerIds.includes(b.id));

  const [orderedBowlerLeagues, setOrderedBowlerLeagues] = useState<BowlerLeague[]>(
    () => [...teamBowlerLeagues].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  );

  // Reset the ordered list when the dialog opens with new data
  useEffect(() => {
    if (open) {
      setOrderedBowlerLeagues([...teamBowlerLeagues].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
    }
  }, [open, teamBowlerLeagues]);

  const moveItem = (index: number, direction: "up" | "down") => {
    const newOrder = [...orderedBowlerLeagues];
    const newIndex = direction === "up" ? index - 1 : index + 1;

    if (newIndex >= 0 && newIndex < newOrder.length) {
      [newOrder[index], newOrder[newIndex]] = [newOrder[newIndex], newOrder[index]];
      setOrderedBowlerLeagues(newOrder);
    }
  };

  const handleSave = async () => {
    try {
      setIsSubmitting(true);

      // Update each bowler league with its new order
      const updates = orderedBowlerLeagues.map((bl, index) =>
        apiRequest("PATCH", `/api/bowler-leagues/${bl.id}`, { order: index })
      );

      await Promise.all(updates);

      // Invalidate all relevant queries to ensure proper refresh
      await Promise.all([
        // Invalidate the specific team's bowler leagues
        queryClient.invalidateQueries({
          queryKey: ["/api/bowler-leagues", { teamId, leagueId }],
          exact: true
        }),
        // Invalidate the bowlers query that depends on the order
        queryClient.invalidateQueries({
          queryKey: ["/api/bowlers"],
          refetchType: 'all'
        }),
        // Invalidate any other bowler leagues queries
        queryClient.invalidateQueries({
          queryKey: ["/api/bowler-leagues"],
          refetchType: 'all'
        })
      ]);

      toast({
        title: "Success",
        description: "Bowler order updated successfully",
      });

      onClose();
    } catch (error) {
      toast({
        title: "Error updating order",
        description: error instanceof Error ? error.message : "Failed to update order",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Reorder Bowlers</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="border rounded-md">
            {orderedBowlerLeagues.map((bl, index) => {
              const bowler = teamBowlers.find(b => b.id === bl.bowlerId);
              if (!bowler) return null;

              return (
                <div
                  key={bl.id}
                  className="flex items-center justify-between p-3 border-b last:border-b-0"
                >
                  <span>{bowler.name}</span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => moveItem(index, "up")}
                      disabled={index === 0}
                    >
                      <ArrowUp className="h-4 w-4" />
                      <span className="sr-only">Move up</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => moveItem(index, "down")}
                      disabled={index === orderedBowlerLeagues.length - 1}
                    >
                      <ArrowDown className="h-4 w-4" />
                      <span className="sr-only">Move down</span>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Order
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}