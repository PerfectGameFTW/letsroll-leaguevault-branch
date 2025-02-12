import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type { Bowler, BowlerLeague } from "@shared/schema";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface AssignBowlerFormProps {
  open: boolean;
  onClose: () => void;
  teamId: number;
  leagueId: number;
}

export function AssignBowlerForm({ open, onClose, teamId, leagueId }: AssignBowlerFormProps) {
  const { toast } = useToast();
  const [selectedBowlerId, setSelectedBowlerId] = useState<string>("");

  // Query to get all bowlers
  const { data: bowlersResponse, isLoading: loadingBowlers } = useQuery<{ data: Bowler[] }>({
    queryKey: ["/api/bowlers"],
    queryFn: async () => {
      const response = await fetch("/api/bowlers");
      if (!response.ok) {
        const text = await response.text();
        console.error("[AssignBowler] Bowlers fetch error response:", text);
        throw new Error("Failed to fetch bowlers");
      }
      const data = await response.json();
      console.log("[AssignBowler] Bowlers fetch successful:", data);
      return data;
    },
  });

  // Query to get bowler leagues to filter out already assigned bowlers
  const { data: bowlerLeaguesResponse, isLoading: loadingBowlerLeagues } = useQuery<{ data: BowlerLeague[] }>({
    queryKey: ["/api/bowler-leagues", leagueId],
    queryFn: async () => {
      const response = await fetch(`/api/bowler-leagues?leagueId=${leagueId}`);
      if (!response.ok) {
        const text = await response.text();
        console.error("[AssignBowler] BowlerLeagues fetch error response:", text);
        throw new Error("Failed to fetch bowler leagues");
      }
      const data = await response.json();
      console.log("[AssignBowler] BowlerLeagues fetch successful:", data);
      return data;
    },
  });

  const bowlers = bowlersResponse?.data || [];
  const bowlerLeagues = bowlerLeaguesResponse?.data || [];

  // Filter out bowlers already in this team/league
  const availableBowlers = bowlers.filter(bowler => {
    const alreadyInTeam = bowlerLeagues.some(bl => 
      bl.bowlerId === bowler.id && 
      bl.leagueId === leagueId && 
      bl.teamId === teamId
    );
    return !alreadyInTeam && bowler.active;
  });

  // Mutation for assigning bowler to team
  const mutation = useMutation({
    mutationFn: async (bowlerId: number) => {
      console.log("[AssignBowler] Starting assignment with payload:", {
        bowlerId,
        leagueId,
        teamId
      });

      try {
        const response = await fetch("/api/bowler-leagues", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            bowlerId,
            leagueId,
            teamId,
          }),
        });

        const text = await response.text();
        console.log("[AssignBowler] Raw response:", text);

        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.error("[AssignBowler] Failed to parse response as JSON:", e);
          throw new Error("Server returned invalid JSON");
        }

        if (!response.ok) {
          throw new Error(data.error || "Failed to assign bowler");
        }

        console.log("[AssignBowler] Assignment successful:", data);
        return data;
      } catch (error) {
        console.error("[AssignBowler] Assignment failed:", error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bowler-leagues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bowlers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/teams/${teamId}`] });
      toast({
        title: "Success",
        description: "Bowler has been added to the team.",
      });
      onClose();
      setSelectedBowlerId("");
    },
    onError: (error: Error) => {
      console.error("[AssignBowler] Error in mutation:", error);
      toast({
        title: "Error assigning bowler",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!selectedBowlerId) return;
    mutation.mutate(parseInt(selectedBowlerId));
  };

  const isLoading = loadingBowlers || loadingBowlerLeagues;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Existing Bowler to Team</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Select Bowler</label>
            {isLoading ? (
              <div className="flex items-center justify-center p-4">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : (
              <Select
                onValueChange={setSelectedBowlerId}
                value={selectedBowlerId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose a bowler" />
                </SelectTrigger>
                <SelectContent>
                  {availableBowlers.length > 0 ? (
                    availableBowlers.map((bowler) => (
                      <SelectItem
                        key={bowler.id}
                        value={bowler.id.toString()}
                      >
                        {bowler.name} ({bowler.email})
                      </SelectItem>
                    ))
                  ) : (
                    <div className="p-2 text-sm text-muted-foreground">
                      No available bowlers found
                    </div>
                  )}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="flex justify-end space-x-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit}
              disabled={!selectedBowlerId || mutation.isPending}
            >
              {mutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Add to Team
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}