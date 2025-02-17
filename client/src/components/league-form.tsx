import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { useEffect, useMemo, useState } from "react";
import { differenceInWeeks } from "date-fns";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RulesEditor } from "@/components/rules-editor";

// Add a new array for weekday options
const weekDayOptions = [
  { value: "Monday", label: "Monday" },
  { value: "Tuesday", label: "Tuesday" },
  { value: "Wednesday", label: "Wednesday" },
  { value: "Thursday", label: "Thursday" },
  { value: "Friday", label: "Friday" },
  { value: "Saturday", label: "Saturday" },
  { value: "Sunday", label: "Sunday" },
];

interface LeagueFormProps {
  open: boolean;
  onClose: () => void;
  league?: League;
}

export function LeagueForm({ open, onClose, league }: LeagueFormProps) {
  const { toast } = useToast();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Initialize dates with noon time to avoid timezone issues
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const nextYear = new Date();
  nextYear.setFullYear(today.getFullYear() + 1);
  nextYear.setHours(12, 0, 0, 0);

  const form = useForm<InsertLeague>({
    resolver: zodResolver(insertLeagueSchema),
    defaultValues: {
      name: "",
      description: "",
      active: true,
      seasonStart: today,
      seasonEnd: nextYear,
      weekDay: "Monday",
      practiceStartTime: "",
      competitionStartTime: "",
      weeklyFee: 2000, // Default to $20.00
      rules: "",
    },
  });

  // Calculate weeks between start and end dates
  const numberOfWeeks = useMemo(() => {
    const start = form.watch('seasonStart');
    const end = form.watch('seasonEnd');
    if (start && end) {
      // Ensure both dates use the same time for comparison
      const startDate = new Date(start);
      startDate.setHours(12, 0, 0, 0);
      const endDate = new Date(end);
      endDate.setHours(12, 0, 0, 0);
      return differenceInWeeks(endDate, startDate);
    }
    return 0;
  }, [form.watch('seasonStart'), form.watch('seasonEnd')]);

  useEffect(() => {
    if (open && league) {
      // When editing, ensure dates are set to noon
      const startDate = new Date(league.seasonStart);
      startDate.setHours(12, 0, 0, 0);
      const endDate = new Date(league.seasonEnd);
      endDate.setHours(12, 0, 0, 0);

      form.reset({
        name: league.name,
        description: league.description || "",
        active: league.active,
        seasonStart: startDate,
        seasonEnd: endDate,
        weekDay: league.weekDay || "Monday",
        practiceStartTime: league.practiceStartTime || "",
        competitionStartTime: league.competitionStartTime || "",
        weeklyFee: league.weeklyFee || 2000,
        rules: league.rules || "",
      });
    } else if (!open) {
      form.reset({
        name: "",
        description: "",
        active: true,
        seasonStart: today,
        seasonEnd: nextYear,
        weekDay: "Monday",
        practiceStartTime: "",
        competitionStartTime: "",
        weeklyFee: 2000,
        rules: "",
      });
      setShowDeleteConfirm(false);
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

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!league) return;
      const response = await apiRequest("DELETE", `/api/leagues/${league.id}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to delete league");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leagues"] });
      toast({
        title: "League deleted",
        description: "The league has been removed from the system.",
      });
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "Error deleting league",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{league ? "Edit League" : "Add New League"}</DialogTitle>
          </DialogHeader>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
              className="space-y-4"
            >
              <div className="space-y-4 pb-4">
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
                              const [year, month, day] = e.target.value.split('-').map(Number);
                              const date = new Date(year, month - 1, day, 12, 0, 0, 0);
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
                              const [year, month, day] = e.target.value.split('-').map(Number);
                              const date = new Date(year, month - 1, day, 12, 0, 0, 0);
                              field.onChange(date);
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* League Info Display */}
                <div className="space-y-3">
                  {/* Season Length Display */}
                  <div className="rounded-lg border p-3">
                    <div className="text-sm font-medium">Season Length</div>
                    <div className="text-2xl font-bold mt-1">{numberOfWeeks} weeks</div>
                  </div>

                  {/* Bowling Day Selection */}
                  <FormField
                    control={form.control}
                    name="weekDay"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bowling Day</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select bowling day" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {weekDayOptions.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Practice and Competition Start Times */}
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="practiceStartTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Practice Start Time</FormLabel>
                        <FormControl>
                          <Input
                            type="time"
                            {...field}
                            value={field.value || ''}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="competitionStartTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Competition Start Time</FormLabel>
                        <FormControl>
                          <Input
                            type="time"
                            {...field}
                            value={field.value || ''}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="weeklyFee"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Weekly Fee</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          {...field}
                          value={field.value / 100}
                          onChange={(e) =>
                            field.onChange(Math.round(parseFloat(e.target.value) * 100))
                          }
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
                <FormField
                  control={form.control}
                  name="rules"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>League Rules</FormLabel>
                      <FormControl>
                        <RulesEditor
                          content={field.value || ""}
                          onChange={field.onChange}
                          readOnly={false}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="sticky bottom-0 bg-background pt-4 border-t">
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

                {league && (
                  <>
                    <Separator className="my-4" />
                    <div className="flex justify-center">
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => setShowDeleteConfirm(true)}
                        disabled={deleteMutation.isPending}
                      >
                        {deleteMutation.isPending && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        Delete League
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to delete this league?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the league "{league?.name}" and all associated teams.
              Bowlers will be unassigned from their teams, but their records and payment history will be preserved.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowDeleteConfirm(false);
                deleteMutation.mutate();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete League
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}