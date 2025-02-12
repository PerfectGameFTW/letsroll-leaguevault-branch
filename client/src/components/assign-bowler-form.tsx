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
import { queryClient, apiRequest } from "@/lib/queryClient";
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

  // Query to get all bowlers with proper error handling and caching
  const { data: bowlersResponse, isLoading: loadingBowlers } = useQuery<{ data: Bowler[] }>({
    queryKey: ["/api/bowlers"],
    queryFn: async () => {
      try {
        const response = await fetch("/api/bowlers");
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Failed to fetch bowlers: ${text}`);
        }
        const data = await response.json();
        console.log("[AssignBowler] Bowlers fetched:", data);
        return data;
      } catch (error) {
        console.error("[AssignBowler] Error fetching bowlers:", error);
        throw error;
      }
    },
    staleTime: 30000, // Cache for 30 seconds
    retry: false,
  });

  // Query to get existing associations with proper error handling
  const { data: bowlerLeaguesResponse, isLoading: loadingBowlerLeagues } = useQuery<{ data: BowlerLeague[] }>({
    queryKey: ["/api/bowler-leagues", { leagueId, teamId }],
    queryFn: async () => {
      try {
        const response = await fetch(`/api/bowler-leagues?leagueId=${leagueId}&teamId=${teamId}`);
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Failed to fetch bowler leagues: ${text}`);
        }
        const data = await response.json();
        console.log("[AssignBowler] Bowler leagues fetched:", data);
        return data;
      } catch (error) {
        console.error("[AssignBowler] Error fetching bowler leagues:", error);
        throw error;
      }
    },
    staleTime: 30000, // Cache for 30 seconds
    retry: false,
  });

  const bowlers = bowlersResponse?.data || [];
  const bowlerLeagues = bowlerLeaguesResponse?.data || [];

  // Filter out bowlers already in this specific league/team combination
  const availableBowlers = bowlers.filter(bowler => {
    const alreadyInTeam = bowlerLeagues.some(bl => 
      bl.bowlerId === bowler.id && 
      bl.leagueId === leagueId && 
      bl.teamId === teamId
    );
    return !alreadyInTeam && bowler.active;
  });

  const mutation = useMutation({
    mutationFn: async (bowlerId: number) => {
      try {
        console.log("[AssignBowler] Assigning bowler:", { bowlerId, leagueId, teamId });
        const response = await apiRequest("POST", "/api/bowler-leagues", {
          bowlerId,
          leagueId,
          teamId,
        });

        if (!response.ok) {
          const text = await response.text();
          console.error("[AssignBowler] Error response:", text);
          throw new Error(text);
        }

        const data = await response.json();
        console.log("[AssignBowler] Assignment successful:", data);
        return data;
      } catch (error) {
        console.error("[AssignBowler] Assignment error:", error);
        if (error instanceof Error) {
          throw new Error(`Failed to assign bowler: ${error.message}`);
        }
        throw error;
      }
    },
    onSuccess: () => {
      // Invalidate relevant queries to ensure data is fresh
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
      console.error("[AssignBowler] Mutation error:", error);
      toast({
        title: "Error assigning bowler",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (selectedBowlerId) {
      mutation.mutate(parseInt(selectedBowlerId));
    }
  };

  // Show loading state while fetching data
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
              disabled={!selectedBowlerId || mutation.isPending || isLoading}
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