import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { insertBowlerSchema, type InsertBowler, type Team, type League, type Bowler, type BowlerLeague } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, X } from "lucide-react";
import { createSquareCustomer } from "@/lib/square";
import { useState, useEffect } from "react";

interface BowlerFormProps {
  open: boolean;
  onClose: () => void;
  defaultTeamId?: number;
  bowler?: Bowler;
}

export function BowlerForm({ open, onClose, defaultTeamId, bowler }: BowlerFormProps) {
  const { toast } = useToast();
  const [selectedLeagueIds, setSelectedLeagueIds] = useState<number[]>([]);

  // Query for leagues
  const { data: leagues } = useQuery<League[]>({
    queryKey: ["/api/leagues"],
  });

  // Query for bowler's leagues if editing
  const { data: bowlerLeagues } = useQuery<BowlerLeague[]>({
    queryKey: [`/api/bowlers/${bowler?.id}/leagues`],
    enabled: !!bowler?.id,
  });

  // Query for teams filtered by selected leagues
  const { data: teams } = useQuery<Team[]>({
    queryKey: ["/api/teams", ...selectedLeagueIds],
    queryFn: () =>
      selectedLeagueIds.length > 0
        ? Promise.all(selectedLeagueIds.map(leagueId =>
            fetch(`/api/teams?leagueId=${leagueId}`).then(res => res.json())
          )).then(responses => responses.flat())
        : Promise.resolve([]),
    enabled: selectedLeagueIds.length > 0,
  });

  const form = useForm<InsertBowler>({
    resolver: zodResolver(insertBowlerSchema),
    defaultValues: bowler ? {
      name: bowler.name,
      email: bowler.email,
      active: bowler.active,
      teamId: bowler.teamId ?? undefined,
      leagueIds: [],
    } : {
      name: "",
      email: "",
      active: true,
      teamId: defaultTeamId,
      leagueIds: [],
    },
  });

  // Initialize or reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      if (bowler && bowlerLeagues) {
        // When editing, set the league IDs from bowlerLeagues
        const leagueIds = bowlerLeagues.map(bl => bl.leagueId);
        setSelectedLeagueIds(leagueIds);
        form.reset({
          name: bowler.name,
          email: bowler.email,
          active: bowler.active,
          teamId: bowler.teamId ?? undefined,
          leagueIds,
        });
      }
    } else {
      // When closing, reset everything
      form.reset({
        name: "",
        email: "",
        active: true,
        teamId: defaultTeamId,
        leagueIds: [],
      });
      setSelectedLeagueIds([]);
    }
  }, [open, bowler, bowlerLeagues, form, defaultTeamId]);

  const mutation = useMutation({
    mutationFn: async (data: InsertBowler) => {
      if (bowler) {
        // Update existing bowler
        const response = await apiRequest("PATCH", `/api/bowlers/${bowler.id}`, data);
        if (!response.ok) {
          const error = await response.text();
          throw new Error(error);
        }
        return await response.json();
      } else {
        // Create new bowler
        // Only create Square customer if teamId is provided
        if (data.teamId) {
          const squareCustomer = await createSquareCustomer(data.name, data.email, data.teamId);
          data.squareCustomerId = squareCustomer.id;
        }

        const response = await apiRequest("POST", "/api/bowlers", data);
        if (!response.ok) {
          const error = await response.text();
          throw new Error(error);
        }
        return await response.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bowlers"] });
      toast({
        title: bowler ? "Bowler updated" : "Bowler created",
        description: bowler
          ? "Bowler has been updated successfully."
          : "Bowler has been added to the system.",
      });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: bowler ? "Error updating bowler" : "Error creating bowler",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAddLeague = (leagueId: string) => {
    const id = parseInt(leagueId);
    if (!selectedLeagueIds.includes(id)) {
      const newIds = [...selectedLeagueIds, id];
      setSelectedLeagueIds(newIds);
      form.setValue('leagueIds', newIds);
      // Reset team selection when leagues change
      form.setValue('teamId', undefined);
    }
  };

  const handleRemoveLeague = (leagueId: number) => {
    const newIds = selectedLeagueIds.filter(id => id !== leagueId);
    setSelectedLeagueIds(newIds);
    form.setValue('leagueIds', newIds);
    // Reset team selection when leagues change
    form.setValue('teamId', undefined);
  };

  // Get the available leagues (not currently selected)
  const availableLeagues = leagues?.filter(league => 
    !selectedLeagueIds.includes(league.id)
  ) || [];

  // Get the current leagues
  const currentLeagues = leagues?.filter(league =>
    selectedLeagueIds.includes(league.id)
  ) || [];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{bowler ? "Edit Bowler" : "Add New Bowler"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="leagueIds"
              render={() => (
                <FormItem className="space-y-4">
                  <FormLabel>League Memberships</FormLabel>

                  {/* Current Leagues */}
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-muted-foreground">Current Leagues</div>
                    {currentLeagues.length > 0 ? (
                      <div className="space-y-2">
                        {currentLeagues.map((league) => (
                          <div key={league.id} className="flex items-center justify-between p-2 border rounded-md">
                            <span>{league.name}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveLeague(league.id)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        No leagues selected
                      </div>
                    )}
                  </div>

                  {/* Add League Dropdown */}
                  {availableLeagues.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-muted-foreground">Add League</div>
                      <Select onValueChange={handleAddLeague}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a league to add" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {availableLeagues.map((league) => (
                            <SelectItem key={league.id} value={league.id.toString()}>
                              {league.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="teamId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Team (Optional)</FormLabel>
                  <Select
                    onValueChange={(value) => field.onChange(value ? parseInt(value) : undefined)}
                    value={field.value?.toString() || ""}
                    disabled={selectedLeagueIds.length === 0}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={selectedLeagueIds.length > 0 ? "Select a team" : "Please select leagues first"} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {teams?.map((team) => (
                        <SelectItem
                          key={team.id}
                          value={team.id.toString()}
                        >
                          {team.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Active</FormLabel>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex justify-end space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {bowler ? "Update" : "Add"} Bowler
              </Button>
            </div>

            {bowler && (
              <>
                <Separator className="my-4" />
                <div className="flex justify-center">
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => {
                      if (window.confirm("Are you sure you want to delete this bowler?")) {
                        // Delete bowler
                        apiRequest("DELETE", `/api/bowlers/${bowler.id}`).then(() => {
                          queryClient.invalidateQueries({ queryKey: ["/api/bowlers"] });
                          toast({
                            title: "Bowler deleted",
                            description: "The bowler has been removed from the system.",
                          });
                          onClose();
                        }).catch((error) => {
                          toast({
                            title: "Error deleting bowler",
                            description: error.message,
                            variant: "destructive",
                          });
                        });
                      }
                    }}
                  >
                    Delete Bowler
                  </Button>
                </div>
              </>
            )}
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}