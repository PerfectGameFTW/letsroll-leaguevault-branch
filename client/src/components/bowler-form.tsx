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
import { insertBowlerSchema, type InsertBowler, type Team, type League, type Bowler } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { useState, useCallback, useEffect } from "react";

interface BowlerFormProps {
  open: boolean;
  onClose: () => void;
  defaultTeamId?: number;
  bowler?: Bowler;
  bowlerLeagues?: { bowlerId: number; leagueId: number; teamId: number }[];
}

export function BowlerForm({ open, onClose, defaultTeamId, bowler, bowlerLeagues }: BowlerFormProps) {
  const { toast } = useToast();
  const [selectedLeagueId, setSelectedLeagueId] = useState<number | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);

  // Move form initialization before any conditional logic
  const form = useForm<InsertBowler>({
    resolver: zodResolver(insertBowlerSchema),
    defaultValues: {
      name: bowler?.name ?? "",
      email: bowler?.email ?? "",
      phone: bowler?.phone ?? "",
      active: bowler?.active ?? true,
    },
  });

  useEffect(() => {
    if (open && bowler) {
      form.reset({
        name: bowler.name,
        email: bowler.email ?? "",
        phone: bowler.phone ?? "",
        active: bowler.active,
      });
      if (bowlerLeagues && bowlerLeagues.length > 0) {
        setSelectedLeagueId(bowlerLeagues[0].leagueId);
        setSelectedTeamId(bowlerLeagues[0].teamId);
      }
    } else if (open && !bowler) {
      form.reset({
        name: "",
        email: "",
        phone: "",
        active: true,
      });
      setSelectedLeagueId(null);
      setSelectedTeamId(null);
    }
  }, [open, bowler]);

  // Query for leagues with proper caching
  const { data: leaguesResponse, isLoading: loadingLeagues } = useQuery<{ success: true, data: League[] }>({
    queryKey: ["/api/leagues"],
    staleTime: 1000 * 60 * 30, // Cache for 30 minutes as league data changes very infrequently
  });

  const leagues = leaguesResponse?.data || [];

  // Query for teams filtered by selected league with proper caching
  const { data: teamsResponse, isLoading: loadingTeams } = useQuery<{ success: true, data: Team[] }>({
    queryKey: ["/api/teams", selectedLeagueId],
    queryFn: () =>
      selectedLeagueId
        ? fetch(`/api/teams?leagueId=${selectedLeagueId}`).then((res) => res.json())
        : Promise.resolve({ success: true, data: [] }),
    enabled: !!selectedLeagueId,
    staleTime: 1000 * 60 * 15, // Cache for 15 minutes as team data changes less frequently
  });

  const teams = teamsResponse?.data || [];

  // Memoize mutation callbacks with proper dependencies
  const onSuccess = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/bowlers"] });
    toast({
      title: bowler ? "Bowler updated" : "Bowler created",
      description: bowler
        ? "Bowler has been updated successfully."
        : "Bowler has been added to the system.",
    });
    onClose();
  }, [bowler, onClose, toast]);

  const onError = useCallback((error: Error) => {
    toast({
      title: bowler ? "Error updating bowler" : "Error creating bowler",
      description: error.message,
      variant: "destructive",
    });
  }, [bowler, toast]);

  const mutation = useMutation({
    mutationFn: async (data: InsertBowler) => {
      if (bowler) {
        const response = await apiRequest(`/api/bowlers/${bowler.id}`, "PATCH", data);
        if (!response.ok) {
          const error = await response.text();
          throw new Error(error);
        }
        return await response.json();
      } else {
        const response = await apiRequest("/api/bowlers", "POST", data);
        if (!response.ok) {
          const error = await response.text();
          throw new Error(error);
        }
        const result = await response.json();
        const newBowlerId = result.data?.id;
        if (newBowlerId && selectedLeagueId && selectedTeamId) {
          const blResponse = await apiRequest("/api/bowler-leagues", "POST", {
            bowlerId: newBowlerId,
            leagueId: selectedLeagueId,
            teamId: selectedTeamId,
            active: true,
          });
          if (!blResponse.ok) {
            console.error("Failed to assign bowler to league/team");
          }
        }
        return result;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bowlers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bowler-leagues"] });
      toast({
        title: bowler ? "Bowler updated" : "Bowler created",
        description: bowler
          ? "Bowler has been updated successfully."
          : "Bowler has been added to the system.",
      });
      setSelectedLeagueId(null);
      setSelectedTeamId(null);
      onClose();
    },
    onError,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!bowler) return;
      const response = await apiRequest(`/api/bowlers/${bowler.id}`, "DELETE");
      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }
    },
    onSuccess,
    onError,
  });

  const isLoading = loadingLeagues || loadingTeams;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{bowler ? "Edit Bowler" : "Add New Bowler"}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : (
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
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl>
                      <Input type="tel" placeholder="(555) 555-5555" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {!bowler && (
                <>
                  <div>
                    <FormLabel>League</FormLabel>
                    <Select
                      value={selectedLeagueId?.toString() ?? ""}
                      onValueChange={(val) => {
                        setSelectedLeagueId(val ? parseInt(val) : null);
                        setSelectedTeamId(null);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a league (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        {leagues.map((league) => (
                          <SelectItem key={league.id} value={league.id.toString()}>
                            {league.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedLeagueId && (
                    <div>
                      <FormLabel>Team</FormLabel>
                      <Select
                        value={selectedTeamId?.toString() ?? ""}
                        onValueChange={(val) => setSelectedTeamId(val ? parseInt(val) : null)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a team" />
                        </SelectTrigger>
                        <SelectContent>
                          {loadingTeams ? (
                            <SelectItem value="loading" disabled>Loading teams...</SelectItem>
                          ) : teams.length === 0 ? (
                            <SelectItem value="none" disabled>No teams in this league</SelectItem>
                          ) : (
                            teams.map((team) => (
                              <SelectItem key={team.id} value={team.id.toString()}>
                                {team.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </>
              )}

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
                  disabled={mutation.isPending}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={mutation.isPending || isLoading}
                  className="min-w-[120px]"
                >
                  {mutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {bowler ? "Updating..." : "Creating..."}
                    </>
                  ) : (
                    bowler ? "Update" : "Add Bowler"
                  )}
                </Button>
              </div>

              {bowler && (
                <>
                  <Separator className="my-4" />
                  <div className="flex justify-center">
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => deleteMutation.mutate()}
                      disabled={deleteMutation.isPending}
                      className="min-w-[120px]"
                    >
                      {deleteMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Deleting...
                        </>
                      ) : (
                        "Delete Bowler"
                      )}
                    </Button>
                  </div>
                </>
              )}
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}