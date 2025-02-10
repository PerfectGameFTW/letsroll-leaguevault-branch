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

  // Query to get all bowlers
  const { data: bowlers = [] } = useQuery<Bowler[]>({
    queryKey: ["/api/bowlers"],
  });

  // Query to get existing associations
  const { data: bowlerLeagues = [] } = useQuery<BowlerLeague[]>({
    queryKey: ["/api/bowler-leagues", leagueId],
    queryFn: async () => {
      const response = await fetch(`/api/bowler-leagues?leagueId=${leagueId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch bowler leagues');
      }
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    },
  });

  // Filter out bowlers already in this specific league/team combination
  const availableBowlers = bowlers.filter(bowler => {
    const existingAssociation = bowlerLeagues.find(bl => 
      bl.bowlerId === bowler.id && 
      bl.leagueId === leagueId && 
      bl.teamId === teamId
    );
    return !existingAssociation;
  });

  const mutation = useMutation({
    mutationFn: async (bowlerId: number) => {
      // Create a new association without affecting existing ones
      const response = await apiRequest("POST", "/api/bowler-leagues", {
        bowlerId,
        leagueId,
        teamId,
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bowler-leagues"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bowlers"] });
      toast({
        title: "Success",
        description: "Bowler has been added to the team.",
      });
      onClose();
      setSelectedBowlerId("");
    },
    onError: (error: Error) => {
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

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Existing Bowler to Team</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Select Bowler</label>
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