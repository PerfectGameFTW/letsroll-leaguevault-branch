import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
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
import { Switch } from "@/components/ui/switch";
import { insertLeagueSchema, type InsertLeague, type League } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo } from "react";
import { differenceInWeeks } from "date-fns";

interface LeagueFormProps {
  open: boolean;
  onClose: () => void;
  league?: League;
}

export function LeagueForm({ open, onClose, league }: LeagueFormProps) {
  const { toast } = useToast();
  const form = useForm<InsertLeague>({
    resolver: zodResolver(insertLeagueSchema),
    defaultValues: {
      name: "",
      description: "",
      active: true,
      seasonStart: new Date(),
      seasonEnd: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
    },
  });

  // Calculate weeks between start and end dates
  const numberOfWeeks = useMemo(() => {
    const start = form.watch('seasonStart');
    const end = form.watch('seasonEnd');
    if (start && end) {
      return differenceInWeeks(end, start);
    }
    return 0;
  }, [form.watch('seasonStart'), form.watch('seasonEnd')]);

  useEffect(() => {
    if (open && league) {
      form.reset({
        name: league.name,
        description: league.description || "",
        active: league.active,
        seasonStart: new Date(league.seasonStart),
        seasonEnd: new Date(league.seasonEnd),
      });
    } else if (!open) {
      form.reset({
        name: "",
        description: "",
        active: true,
        seasonStart: new Date(),
        seasonEnd: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
      });
    }
  }, [open, league, form]);

  const mutation = useMutation({
    mutationFn: async (data: InsertLeague) => {
      const response = await apiRequest(
        league ? "PATCH" : "POST",
        league ? `/api/leagues/${league.id}` : "/api/leagues",
        {
          ...data,
          seasonStart: data.seasonStart.toISOString(),
          seasonEnd: data.seasonEnd.toISOString(),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }

      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leagues"] });
      toast({
        title: league ? "League updated" : "League created",
        description: league
          ? "League has been updated successfully."
          : "League has been created successfully.",
      });
      onClose();
      form.reset();
    },
    onError: (error: Error) => {
      toast({
        title: league ? "Error updating league" : "Error creating league",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{league ? "Edit League" : "Add New League"}</DialogTitle>
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
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value || ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="seasonStart"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Season Start</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        {...field}
                        value={field.value instanceof Date ? field.value.toISOString().split('T')[0] : ''}
                        onChange={(e) => {
                          const date = new Date(e.target.value);
                          date.setHours(12); // Set to noon to avoid timezone issues
                          field.onChange(date);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="seasonEnd"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Season End</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        {...field}
                        value={field.value instanceof Date ? field.value.toISOString().split('T')[0] : ''}
                        onChange={(e) => {
                          const date = new Date(e.target.value);
                          date.setHours(12); // Set to noon to avoid timezone issues
                          field.onChange(date);
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Number of Weeks Display */}
            <div className="rounded-lg border p-3">
              <div className="text-sm font-medium">Season Length</div>
              <div className="text-2xl font-bold mt-1">{numberOfWeeks} weeks</div>
            </div>

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
                {league ? "Update" : "Add"} League
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}