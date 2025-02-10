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
import { useState, useEffect } from "react";

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

  // Query for leagues
  const { data: leaguesResponse } = useQuery<League[]>({
    queryKey: ["/api/leagues"],
  });

  const leagues = leaguesResponse || [];

  // Query for teams filtered by selected league
  const { data: teamsResponse } = useQuery<Team[]>({
    queryKey: ["/api/teams", selectedLeagueId],
    queryFn: () =>
      selectedLeagueId
        ? fetch(`/api/teams?leagueId=${selectedLeagueId}`).then((res) => res.json())
        : Promise.resolve([]),
    enabled: !!selectedLeagueId,
  });

  const teams = teamsResponse || [];

  const form = useForm<InsertBowler>({
    resolver: zodResolver(insertBowlerSchema),
    defaultValues: bowler ? {
      name: bowler.name,
      email: bowler.email,
      active: bowler.active,
      teamId: bowler.teamId,
    } : {
      name: "",
      email: "",
      active: true,
      teamId: defaultTeamId,
    },
  });

  // Initialize or reset form when dialog opens/closes
  useEffect(() => {
    if (open && bowler) {
      const bowlerLeague = bowlerLeagues?.find(bl => bl.bowlerId === bowler.id);
      setSelectedLeagueId(bowlerLeague?.leagueId || null);
      form.reset({
        name: bowler.name,
        email: bowler.email,
        active: bowler.active,
        teamId: bowler.teamId,
      });
    } else if (!open) {
      form.reset({
        name: "",
        email: "",
        active: true,
        teamId: defaultTeamId,
      });
      setSelectedLeagueId(null);
    }
  }, [open, bowler, form, defaultTeamId, bowlerLeagues]);

  const mutation = useMutation({
    mutationFn: async (data: InsertBowler) => {
      if (bowler) {
        const response = await apiRequest("PATCH", `/api/bowlers/${bowler.id}`, data);
        if (!response.ok) {
          const error = await response.text();
          throw new Error(error);
        }
        return await response.json();
      } else {
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

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!bowler) return;
      const response = await apiRequest("DELETE", `/api/bowlers/${bowler.id}`);
      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bowlers"] });
      toast({
        title: "Bowler deleted",
        description: "The bowler has been removed from the system.",
      });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Error deleting bowler",
        description: error.message,
        variant: "destructive",
      });
    },
  });

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

            <FormField
              control={form.control}
              name="teamId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Team</FormLabel>
                  <Select
                    onValueChange={(value) => field.onChange(value ? parseInt(value) : null)}
                    value={field.value?.toString() || ""}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a team" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Array.isArray(teams) && teams.map((team) => (
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
                    onClick={() => deleteMutation.mutate()}
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
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