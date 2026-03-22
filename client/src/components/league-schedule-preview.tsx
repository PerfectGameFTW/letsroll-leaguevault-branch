import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, CalendarX, SkipForward, Check } from "lucide-react";

interface ScheduleDate {
  date: Date;
  isoDate: string;
  type: 'normal' | 'skip' | 'cancelled';
  bowlingWeekNumber: number;
}

interface LeagueSchedulePreviewProps {
  scheduleDates: ScheduleDate[];
  showSchedule: boolean;
  setShowSchedule: (fn: (prev: boolean) => boolean) => void;
  bowlingWeeks: number;
  skipDates: string[];
  cancelledDates: string[];
  effectiveBowlingWeeks: number;
  computedSeasonEnd: Date | null;
  toggleDateType: (isoDate: string, currentType: 'normal' | 'skip' | 'cancelled') => void;
}

export function LeagueSchedulePreview({
  scheduleDates,
  showSchedule,
  setShowSchedule,
  bowlingWeeks,
  skipDates,
  cancelledDates,
  effectiveBowlingWeeks,
  computedSeasonEnd,
  toggleDateType,
}: LeagueSchedulePreviewProps) {
  if (scheduleDates.length === 0) return null;

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium"
        onClick={() => setShowSchedule(s => !s)}
      >
        <span className="flex flex-col items-start gap-0.5">
          <span>Bowling Schedule</span>
          {bowlingWeeks > 0 && (
            <span className="text-xs text-muted-foreground font-normal">
              {bowlingWeeks} planned week{bowlingWeeks !== 1 ? 's' : ''}
              {skipDates.length > 0 && ` · ${skipDates.length} holiday skip${skipDates.length !== 1 ? 's' : ''}`}
              {cancelledDates.length > 0 && ` · ${cancelledDates.length} cancellation${cancelledDates.length !== 1 ? 's' : ''}`}
              {computedSeasonEnd && ` · ends ${computedSeasonEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
            </span>
          )}
        </span>
        {showSchedule ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {showSchedule && (
        <div className="border-t">
          <div className="px-3 py-2 text-xs text-muted-foreground bg-muted/30">
            Click a date to cycle: <span className="font-medium">Normal → Skip (holiday, season extends) → Cancelled (no makeup, season shortens)</span>
          </div>
          <div className="divide-y max-h-72 overflow-y-auto">
            {scheduleDates.map((week) => {
              const weekLabel = week.type === 'skip'
                ? 'Skip'
                : week.type === 'cancelled'
                ? 'Cancelled'
                : `Week ${week.bowlingWeekNumber}`;
              return (
                <button
                  type="button"
                  key={week.isoDate}
                  onClick={() => toggleDateType(week.isoDate, week.type)}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-sm hover:bg-muted/50 transition-colors ${
                    week.type === 'skip'
                      ? 'bg-yellow-50 dark:bg-yellow-950/20'
                      : week.type === 'cancelled'
                      ? 'bg-red-50 dark:bg-red-950/20'
                      : ''
                  }`}
                >
                  <span className={week.type !== 'normal' ? 'text-muted-foreground line-through' : ''}>
                    {week.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  <Badge
                    variant={week.type === 'normal' ? 'outline' : 'secondary'}
                    className={`ml-2 text-xs shrink-0 ${
                      week.type === 'skip'
                        ? 'border-yellow-400 text-yellow-700 dark:text-yellow-400'
                        : week.type === 'cancelled'
                        ? 'border-red-400 text-red-700 dark:text-red-400'
                        : ''
                    }`}
                  >
                    {week.type === 'skip' && <SkipForward className="mr-1 h-3 w-3" />}
                    {week.type === 'cancelled' && <CalendarX className="mr-1 h-3 w-3" />}
                    {week.type === 'normal' && <Check className="mr-1 h-3 w-3" />}
                    {weekLabel}
                  </Badge>
                </button>
              );
            })}
          </div>
          <div className="border-t px-3 py-2 text-xs text-muted-foreground bg-muted/30 flex justify-between">
            <span>{effectiveBowlingWeeks} bowling week{effectiveBowlingWeeks !== 1 ? 's' : ''}</span>
            {computedSeasonEnd && (
              <span>Season ends {computedSeasonEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
