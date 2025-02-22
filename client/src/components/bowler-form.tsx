import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Separator } from "@/components/ui/separator";
import { insertBowlerSchema, type InsertBowler, type Bowler } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { useState } from "react";

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
  const queryClient = useQueryClient();

  const form = useForm<InsertBowler>({
    resolver: zodResolver(insertBowlerSchema),
    defaultValues: {
      name: bowler?.name ?? "",
      email: bowler?.email ?? "",
      active: bowler?.active ?? true,
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: InsertBowler) => {
      try {
        let response;
        if (bowler) {
          response = await apiRequest("PATCH", `/api/bowlers/${bowler.id}`, data);
        } else {
          response = await apiRequest("POST", "/api/bowlers", data);
        }

        if (!response.ok) {
          const error = await response.text();
          throw new Error(error);
        }

        const result = await response.json();
        if (!result.data?.squareCustomerId) {
          throw new Error("Failed to create Square customer record");
        }

        return result;
      } catch (error) {
        console.error('Error in bowler mutation:', error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bowlers"] });
      toast({
        title: bowler ? "Bowler updated" : "Bowler created",
        description: bowler
          ? "Bowler has been updated successfully."
          : "Bowler has been added to the system with Square customer record.",
      });
      onClose();
    },
    onError: (error: Error) => {
      console.error('Bowler mutation error:', error);
      toast({
        title: bowler ? "Error updating bowler" : "Error creating bowler",
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
                  <FormLabel>Email (Required for Square)</FormLabel>
                  <FormControl>
                    <Input 
                      type="email" 
                      {...field} 
                      required
                      placeholder="Enter email address"
                    />
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
                disabled={mutation.isPending}
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
                    onClick={() => {
                      if (confirm("Are you sure you want to delete this bowler?")) {
                        mutation.mutate({
                          ...form.getValues(),
                          active: false
                        });
                      }
                    }}
                    disabled={mutation.isPending}
                    className="min-w-[120px]"
                  >
                    {mutation.isPending ? (
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
      </DialogContent>
    </Dialog>
  );
}