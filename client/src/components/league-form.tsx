import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
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
import { Badge } from "@/components/ui/badge";
import { insertLeagueSchema, type InsertLeague, type League, type Location, type PaymentMode } from "@shared/schema";
import { calculateSeasonEnd, getAllBowlingDates, getEffectiveBowlingWeeks, toIsoDateStr } from "@shared/schedule-utils";
import { LeagueSchedulePreview } from "@/components/league-schedule-preview";
import { LeagueSquareCatalog } from "@/components/league-square-catalog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ChevronDown, ChevronUp, CalendarX, SkipForward, Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { differenceInWeeks } from "date-fns";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  const [showSchedule, setShowSchedule] = useState(false);
  const [bowlingWeeks, setBowlingWeeks] = useState<number>(30);
  const [skipDates, setSkipDates] = useState<string[]>([]);
  const [cancelledDates, setCancelledDates] = useState<string[]>([]);

  const { data: locationsData } = useQuery<{ success: boolean; data: Location[] }>({
    queryKey: ['/api/locations'],
  });
  const activeLocations = (locationsData?.data || []).filter(l => l.active);

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const isResettingForm = useRef(false);

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
      timezone: "America/Chicago",
      weeklyFee: 2000,
      lineageFee: null,
      prizeFundFee: null,
      finalTwoWeeksDueWeek: 6,
      paymentMode: "weekly",
      squareLineageItemId: null,
      squareLineageItemVariationId: null,
      squareLineageItemName: null,
      squarePrizeFundItemId: null,
      squarePrizeFundItemVariationId: null,
      squarePrizeFundItemName: null,
      squareCategoryId: null,
      locationId: null,
      totalBowlingWeeks: 30,
      skipDates: [],
      cancelledDates: [],
    },
  });

  const watchedStart = form.watch('seasonStart');
  const watchedWeekDay = form.watch('weekDay');
  const watchedPaymentMode = form.watch('paymentMode');
  const isUpfront = watchedPaymentMode === 'upfront';
  const watchedWeeklyFee = form.watch('weeklyFee');
  const watchedLocationId = form.watch('locationId');

  const computedSeasonEnd = useMemo(() => {
    if (!watchedStart || !watchedWeekDay || bowlingWeeks <= 0) return null;
    return calculateSeasonEnd(watchedStart, watchedWeekDay, bowlingWeeks, skipDates, cancelledDates);
  }, [watchedStart, watchedWeekDay, bowlingWeeks, skipDates, cancelledDates]);

  const effectiveBowlingWeeks = useMemo(
    () => getEffectiveBowlingWeeks(bowlingWeeks, cancelledDates),
    [bowlingWeeks, cancelledDates]
  );

  const scheduleDates = useMemo(() => {
    if (!watchedStart || !watchedWeekDay || bowlingWeeks <= 0) return [];
    return getAllBowlingDates(watchedStart, watchedWeekDay, bowlingWeeks, skipDates, cancelledDates);
  }, [watchedStart, watchedWeekDay, bowlingWeeks, skipDates, cancelledDates]);

  useEffect(() => {
    if (computedSeasonEnd) {
      form.setValue('seasonEnd', computedSeasonEnd);
    }
  }, [computedSeasonEnd]);

  const toggleDateType = (isoDate: string, currentType: 'normal' | 'skip' | 'cancelled') => {
    if (currentType === 'normal') {
      setSkipDates(prev => [...prev, isoDate]);
    } else if (currentType === 'skip') {
      setSkipDates(prev => prev.filter(d => d !== isoDate));
      setCancelledDates(prev => [...prev, isoDate]);
    } else {
      setCancelledDates(prev => prev.filter(d => d !== isoDate));
    }
  };

  useEffect(() => {
    if (isResettingForm.current) return;
    if (watchedStart) {
      const date = new Date(watchedStart);
      if (!isNaN(date.getTime())) {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        form.setValue('weekDay', dayNames[date.getDay()] as "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday");
      }
    }
  }, [watchedStart]);

  useEffect(() => {
    if (open && league) {
      const startDate = new Date(league.seasonStart);
      startDate.setHours(12, 0, 0, 0);
      const endDate = new Date(league.seasonEnd);
      endDate.setHours(12, 0, 0, 0);

      const initialWeeks = league.totalBowlingWeeks
        ?? Math.max(1, differenceInWeeks(endDate, startDate));
      setBowlingWeeks(initialWeeks);
      setSkipDates(league.skipDates ?? []);
      setCancelledDates(league.cancelledDates ?? []);
      setShowSchedule(false);
      setSelectedCategoryId(league.squareCategoryId || null);

      isResettingForm.current = true;
      form.reset({
        name: league.name,
        description: league.description || "",
        active: league.active,
        seasonStart: startDate,
        seasonEnd: endDate,
        weekDay: league.weekDay || "Monday",
        practiceStartTime: league.practiceStartTime || "",
        competitionStartTime: league.competitionStartTime || "",
        timezone: league.timezone || "America/Chicago",
        weeklyFee: league.weeklyFee || 2000,
        lineageFee: league.lineageFee ?? null,
        prizeFundFee: league.prizeFundFee ?? null,
        finalTwoWeeksDueWeek: league.finalTwoWeeksDueWeek ?? 6,
        paymentMode: (league.paymentMode as PaymentMode) || "weekly",
        squareLineageItemId: league.squareLineageItemId || null,
        squareLineageItemVariationId: league.squareLineageItemVariationId || null,
        squareLineageItemName: league.squareLineageItemName || null,
        squarePrizeFundItemId: league.squarePrizeFundItemId || null,
        squarePrizeFundItemVariationId: league.squarePrizeFundItemVariationId || null,
        squarePrizeFundItemName: league.squarePrizeFundItemName || null,
        squareCategoryId: league.squareCategoryId || null,
        locationId: league.locationId || null,
        totalBowlingWeeks: initialWeeks,
        skipDates: league.skipDates ?? [],
        cancelledDates: league.cancelledDates ?? [],
      });
      setTimeout(() => { isResettingForm.current = false; }, 0);
    } else if (!open) {
      isResettingForm.current = true;
      form.reset({
        name: "",
        description: "",
        active: true,
        seasonStart: today,
        seasonEnd: nextYear,
        weekDay: "Monday",
        practiceStartTime: "",
        competitionStartTime: "",
        timezone: "America/Chicago",
        weeklyFee: 2000,
        lineageFee: null,
        prizeFundFee: null,
        finalTwoWeeksDueWeek: 6,
        paymentMode: "weekly",
        squareLineageItemId: null,
        squareLineageItemVariationId: null,
        squareLineageItemName: null,
        squarePrizeFundItemId: null,
        squarePrizeFundItemVariationId: null,
        squarePrizeFundItemName: null,
        squareCategoryId: null,
        locationId: null,
        totalBowlingWeeks: 30,
        skipDates: [],
        cancelledDates: [],
      });
      setTimeout(() => { isResettingForm.current = false; }, 0);
      setBowlingWeeks(30);
      setSkipDates([]);
      setCancelledDates([]);
      setShowSchedule(false);
      setShowDeleteConfirm(false);
      setSelectedCategoryId(null);
    }
  }, [open, league, form]);

  const mutation = useMutation({
    mutationFn: async (data: InsertLeague) => {
      const derivedEnd = computedSeasonEnd ?? data.seasonEnd;
      return apiRequest(
        league ? `/api/leagues/${league.id}` : "/api/leagues",
        league ? "PATCH" : "POST",
        {
          ...data,
          seasonStart: data.seasonStart.toISOString(),
          seasonEnd: derivedEnd instanceof Date ? derivedEnd.toISOString() : derivedEnd,
          totalBowlingWeeks: bowlingWeeks,
          skipDates,
          cancelledDates,
        }
      );
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
      return apiRequest(`/api/leagues/${league.id}`, "DELETE");
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
                {activeLocations.length > 0 && (
                  <FormField
                    control={form.control}
                    name="locationId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Location</FormLabel>
                        <Select
                          onValueChange={(value) => {
                            field.onChange(value === "none" ? null : parseInt(value));
                            setSelectedCategoryId(null);
                            form.setValue('squareCategoryId', null);
                            form.setValue('squareLineageItemId', null);
                            form.setValue('squareLineageItemVariationId', null);
                            form.setValue('squareLineageItemName', null);
                            form.setValue('squarePrizeFundItemId', null);
                            form.setValue('squarePrizeFundItemVariationId', null);
                            form.setValue('squarePrizeFundItemName', null);
                          }}
                          value={field.value ? String(field.value) : "none"}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a location" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="none">No Location</SelectItem>
                            {activeLocations.map((location) => (
                              <SelectItem key={location.id} value={String(location.id)}>
                                {location.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

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
                            value={field.value instanceof Date && !isNaN(field.value.getTime()) ? field.value.toISOString().split('T')[0] : ''}
                            onChange={(e) => {
                              const [year, month, day] = e.target.value.split('-').map(Number);
                              const date = new Date(year, month - 1, day, 12, 0, 0, 0);
                              field.onChange(date);
                              setSkipDates([]);
                              setCancelledDates([]);
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div>
                    <label className="text-sm font-medium">Season End</label>
                    <div className="mt-1.5 flex h-9 items-center rounded-md border bg-muted/50 px-3 text-sm text-muted-foreground">
                      {computedSeasonEnd
                        ? computedSeasonEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : '—'}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Auto-calculated from schedule</p>
                  </div>
                </div>

                {/* League Info Display */}
                <div className="space-y-3">
                  {/* Bowling Weeks Input */}
                  <div>
                    <label className="text-sm font-medium">Bowling Weeks</label>
                    <Input
                      type="number"
                      min={1}
                      max={52}
                      value={bowlingWeeks || ''}
                      onChange={(e) => {
                        const w = parseInt(e.target.value) || 1;
                        setBowlingWeeks(w);
                        setSkipDates([]);
                        setCancelledDates([]);
                      }}
                      placeholder="Number of bowling weeks"
                      className="mt-1.5"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Total planned bowling weeks (not counting holidays/cancellations)
                    </p>
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

                <LeagueSchedulePreview
                  scheduleDates={scheduleDates}
                  showSchedule={showSchedule}
                  setShowSchedule={setShowSchedule}
                  bowlingWeeks={bowlingWeeks}
                  skipDates={skipDates}
                  cancelledDates={cancelledDates}
                  effectiveBowlingWeeks={effectiveBowlingWeeks}
                  computedSeasonEnd={computedSeasonEnd}
                  toggleDateType={toggleDateType}
                />

                {/* Competition Start Time */}
                <div className="grid grid-cols-1 gap-4">
                  <FormField
                    control={form.control}
                    name="competitionStartTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>League Start Time</FormLabel>
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
                  name="timezone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Timezone</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value || 'America/Chicago'}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select timezone" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="America/New_York">Eastern (ET)</SelectItem>
                          <SelectItem value="America/Chicago">Central (CT)</SelectItem>
                          <SelectItem value="America/Denver">Mountain (MT)</SelectItem>
                          <SelectItem value="America/Phoenix">Arizona (MST)</SelectItem>
                          <SelectItem value="America/Los_Angeles">Pacific (PT)</SelectItem>
                          <SelectItem value="America/Anchorage">Alaska (AKT)</SelectItem>
                          <SelectItem value="Pacific/Honolulu">Hawaii (HST)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="paymentMode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Payment Mode</FormLabel>
                      <Select
                        onValueChange={(value) => field.onChange(value as PaymentMode)}
                        value={field.value || "weekly"}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="weekly">Weekly — bowlers pay each week</SelectItem>
                          <SelectItem value="upfront">Full Season Upfront — full amount due at start</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {activeLocations.length > 0 && (
                  <LeagueSquareCatalog
                    form={form}
                    locationId={watchedLocationId}
                    selectedCategoryId={selectedCategoryId}
                    onCategoryChange={setSelectedCategoryId}
                  />
                )}

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

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="lineageFee"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Lineage Fee</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            value={field.value != null ? field.value / 100 : ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              field.onChange(val === "" ? null : Math.round(parseFloat(val) * 100));
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="prizeFundFee"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Prize Fund Fee</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="0.00"
                            value={field.value != null ? field.value / 100 : ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              field.onChange(val === "" ? null : Math.round(parseFloat(val) * 100));
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                {(() => {
                  const lf = form.watch('lineageFee');
                  const pf = form.watch('prizeFundFee');
                  const wf = form.watch('weeklyFee');
                  if ((lf != null || pf != null) && wf > 0) {
                    const total = (lf ?? 0) + (pf ?? 0);
                    const matches = total === wf;
                    return (
                      <p className={`text-xs ${matches ? 'text-muted-foreground' : 'text-destructive'}`}>
                        Lineage + Prize Fund = ${(total / 100).toFixed(2)} {matches ? '✓ matches weekly fee' : `— must equal $${(wf / 100).toFixed(2)}`}
                      </p>
                    );
                  }
                  return null;
                })()}

                {!isUpfront && (
                  <FormField
                    control={form.control}
                    name="finalTwoWeeksDueWeek"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Final 2 Weeks Due By</FormLabel>
                        <Select
                          onValueChange={(value) => field.onChange(parseInt(value))}
                          value={String(field.value ?? 6)}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select week" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {Array.from({ length: 10 }, (_, i) => i + 1).map((week) => (
                              <SelectItem key={week} value={String(week)}>
                                Week {week}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {isUpfront && effectiveBowlingWeeks > 0 && watchedWeeklyFee > 0 && (
                  <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                    <div className="font-medium">Full Season Total</div>
                    <div className="text-muted-foreground mt-1">
                      ${(watchedWeeklyFee / 100).toFixed(2)} &times; {effectiveBowlingWeeks} weeks ={" "}
                      <span className="font-semibold text-foreground">
                        ${((watchedWeeklyFee * effectiveBowlingWeeks) / 100).toFixed(2)}
                      </span>{" "}
                      due upfront per bowler
                    </div>
                  </div>
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