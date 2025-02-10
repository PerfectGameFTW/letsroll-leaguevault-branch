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
import { insertBowlerSchema, type InsertBowler, type Team, type League, type Bowler, type BowlerLeague, type BowlerTeam } from "@shared/schema";
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
  const [teamAssignments, setTeamAssignments] = useState<Map<number, number>>(new Map());

  // Query for leagues
  const { data: leagues } = useQuery<League[]>({
    queryKey: ["/api/leagues"],
  });

  // Query for bowler's leagues if editing
  const { data: bowlerLeagues } = useQuery<BowlerLeague[]>({
    queryKey: [`/api/bowlers/${bowler?.id}/leagues`],
    enabled: !!bowler?.id,
  });

  // Query for bowler's teams if editing
  const { data: bowlerTeams } = useQuery<BowlerTeam[]>({
    queryKey: [`/api/bowlers/${bowler?.id}/teams`],
    enabled: !!bowler?.id,
  });

  // Query for teams filtered by selected leagues
  const { data: teamsMap } = useQuery<{ [leagueId: number]: Team[] }>({
    queryKey: ["/api/teams", ...selectedLeagueIds],
    queryFn: async () => {
      if (selectedLeagueIds.length === 0) return {};

      const leagueTeams = await Promise.all(
        selectedLeagueIds.map(leagueId =>
          fetch(`/api/teams?leagueId=${leagueId}`)
            .then(res => res.json())
            .then(teams => ({ [leagueId]: teams }))
        )
      );

      return Object.assign({}, ...leagueTeams);
    },
    enabled: selectedLeagueIds.length > 0,
  });

  const form = useForm<InsertBowler>({
    resolver: zodResolver(insertBowlerSchema),
    defaultValues: bowler ? {
      name: bowler.name,
      email: bowler.email,
      active: bowler.active,
      teamAssignments: [],
      leagueIds: [],
    } : {
      name: "",
      email: "",
      active: true,
      teamAssignments: [],
      leagueIds: [],
    },
  });

  // Update useEffect to handle default team assignment
  useEffect(() => {
    if (open) {
      if (bowler && bowlerLeagues && bowlerTeams) {
        // When editing, set the league IDs and team assignments from existing data
        const leagueIds = bowlerLeagues.map(bl => bl.leagueId);
        setSelectedLeagueIds(leagueIds);

        const assignments = new Map<number, number>();
        bowlerTeams.forEach(bt => {
          assignments.set(bt.leagueId, bt.teamId);
        });
        setTeamAssignments(assignments);

        form.reset({
          name: bowler.name,
          email: bowler.email,
          active: bowler.active,
          teamAssignments: bowlerTeams.map(bt => ({
            leagueId: bt.leagueId,
            teamId: bt.teamId,
          })),
          leagueIds,
        });
      } else if (defaultTeamId && leagues) {
        // For new bowler with default team
        const team = teamsMap?.[leagues[0]?.id]?.find(t => t.id === defaultTeamId);
        if (team) {
          const leagueId = team.leagueId;
          setSelectedLeagueIds([leagueId]);
          setTeamAssignments(new Map([[leagueId, defaultTeamId]]));
          form.reset({
            name: "",
            email: "",
            active: true,
            teamAssignments: [{
              leagueId,
              teamId: defaultTeamId,
            }],
            leagueIds: [leagueId],
          });
        }
      } else {
        // Reset form for new bowler without default team
        form.reset({
          name: "",
          email: "",
          active: true,
          teamAssignments: [],
          leagueIds: [],
        });
        setSelectedLeagueIds([]);
        setTeamAssignments(new Map());
      }
    }
  }, [open, bowler, bowlerLeagues, bowlerTeams, leagues, defaultTeamId, form, teamsMap]);

  // Update the form mutation
  const mutation = useMutation({
    mutationFn: async (data: InsertBowler) => {
      // Convert teamAssignments Map to array format expected by API
      data.teamAssignments = Array.from(teamAssignments.entries()).map(([leagueId, teamId]) => ({
        leagueId,
        teamId,
      }));

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
      // Also invalidate the team bowlers query if we have a team ID
      if (defaultTeamId) {
        queryClient.invalidateQueries({ queryKey: ["/api/teams", defaultTeamId, "bowlers"] });
      }
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
    }
  };

  const handleRemoveLeague = (leagueId: number) => {
    const newIds = selectedLeagueIds.filter(id => id !== leagueId);
    setSelectedLeagueIds(newIds);
    form.setValue('leagueIds', newIds);

    // Also remove any team assignment for this league
    const newAssignments = new Map(teamAssignments);
    newAssignments.delete(leagueId);
    setTeamAssignments(newAssignments);
  };

  const handleTeamAssignment = (leagueId: number, teamId: string | undefined) => {
    const newAssignments = new Map(teamAssignments);
    if (teamId) {
      newAssignments.set(leagueId, parseInt(teamId));
    } else {
      newAssignments.delete(leagueId);
    }
    setTeamAssignments(newAssignments);
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
                      <div className="space-y-4">
                        {currentLeagues.map((league) => (
                          <div key={league.id} className="space-y-2">
                            <div className="flex items-center justify-between p-2 border rounded-md">
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

                            {/* Team selection for this league */}
                            <div className="pl-4">
                              <div className="text-sm font-medium text-muted-foreground mb-1">
                                Team for {league.name}
                              </div>
                              <Select
                                value={teamAssignments.get(league.id)?.toString()}
                                onValueChange={(value) => handleTeamAssignment(league.id, value)}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Select a team" />
                                </SelectTrigger>
                                <SelectContent>
                                  {teamsMap?.[league.id]?.map((team) => (
                                    <SelectItem
                                      key={team.id}
                                      value={team.id.toString()}
                                    >
                                      {team.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
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