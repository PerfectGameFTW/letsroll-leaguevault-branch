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
import { Form } from "@/components/ui/form";
import { insertLeagueSchema, type InsertLeague, type League, type Location, type PaymentMode } from "@shared/schema";
import { calculateSeasonEnd, getAllBowlingDates, getEffectiveBowlingWeeks } from "@shared/schedule-utils";
import { LeagueSchedulePreview } from "@/components/league-schedule-preview";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { differenceInWeeks } from "date-fns";
import { Separator } from "@/components/ui/separator";
import { LeagueBasicInfo } from "@/components/league-form-basic-info";
import { LeagueScheduleSection } from "@/components/league-form-schedule";
import { LeagueTimingSection } from "@/components/league-form-timing";
import { LeagueFeeSection } from "@/components/league-form-fees";

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
      seasonStart: today.toISOString(),
      seasonEnd: nextYear.toISOString(),
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
      form.setValue('seasonEnd', computedSeasonEnd.toISOString());
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
        seasonStart: startDate.toISOString(),
        seasonEnd: endDate.toISOString(),
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
        seasonStart: today.toISOString(),
        seasonEnd: nextYear.toISOString(),
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
          seasonStart: data.seasonStart,
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

  const handleLocationChange = (value: string) => {
    setSelectedCategoryId(null);
    form.setValue('squareCategoryId', null);
    form.setValue('squareLineageItemId', null);
    form.setValue('squareLineageItemVariationId', null);
    form.setValue('squareLineageItemName', null);
    form.setValue('squarePrizeFundItemId', null);
    form.setValue('squarePrizeFundItemVariationId', null);
    form.setValue('squarePrizeFundItemName', null);
  };

  const handleSeasonStartChange = () => {
    setSkipDates([]);
    setCancelledDates([]);
  };

  const handleBowlingWeeksChange = (w: number) => {
    setBowlingWeeks(w);
    setSkipDates([]);
    setCancelledDates([]);
  };

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
                <LeagueBasicInfo
                  form={form}
                  activeLocations={activeLocations}
                  onLocationChange={handleLocationChange}
                />

                <LeagueScheduleSection
                  form={form}
                  bowlingWeeks={bowlingWeeks}
                  computedSeasonEnd={computedSeasonEnd}
                  onSeasonStartChange={handleSeasonStartChange}
                  onBowlingWeeksChange={handleBowlingWeeksChange}
                />

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

                <LeagueTimingSection form={form} />

                <LeagueFeeSection
                  form={form}
                  isUpfront={isUpfront}
                  effectiveBowlingWeeks={effectiveBowlingWeeks}
                  activeLocations={activeLocations}
                  watchedLocationId={watchedLocationId}
                  watchedWeeklyFee={watchedWeeklyFee}
                  selectedCategoryId={selectedCategoryId}
                  onCategoryChange={setSelectedCategoryId}
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
