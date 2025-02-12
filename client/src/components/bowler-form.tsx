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
import { useState, useCallback } from "react";

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

  const form = useForm<InsertBowler>({
    resolver: zodResolver(insertBowlerSchema),
    defaultValues: bowler ? {
      name: bowler.name,
      email: bowler.email,
      active: bowler.active,
    } : {
      name: "",
      email: "",
      active: true,
    },
  });

  // Memoize mutation callbacks to prevent unnecessary re-renders
  const onSuccess = useCallback(() => {
    // Invalidate only the bowlers query when a bowler is updated
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
    onSuccess,
    onError,
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