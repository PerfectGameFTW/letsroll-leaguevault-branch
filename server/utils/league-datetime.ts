import { addWeeks, nextDay, setHours, setMinutes, setSeconds, setMilliseconds } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { toIsoDateStr, isDateSkippedOrCancelled } from '@shared/schedule-utils';
import { DEFAULT_TIMEZONE } from '@shared/schema';

const WEEKDAY_MAP: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
  Thursday: 4, Friday: 5, Saturday: 6,
};

export function getNextLeagueDateTime(
  afterDate: Date,
  weekDay: string,
  competitionStartTime: string | null | undefined,
  timezone: string = DEFAULT_TIMEZONE,
  skipDates: string[] = [],
  cancelledDates: string[] = []
): Date {
  const [hours, minutes] = competitionStartTime
    ? competitionStartTime.split(':').map(Number)
    : [12, 0];

  const dayIndex = WEEKDAY_MAP[weekDay];
  if (dayIndex === undefined) {
    return addWeeks(afterDate, 1);
  }

  // Work in league-local time so day-of-week and time comparisons reflect the
  // league's calendar, not the server's UTC clock.
  const afterLocal = toZonedTime(afterDate, timezone);

  let target: Date;

  // If today is already the correct weekday AND the scheduled time today has
  // not yet passed, use tonight rather than jumping ahead a full week.
  const todayIsCorrectDay = afterLocal.getDay() === dayIndex;
  const scheduledTimeToday = setMilliseconds(
    setSeconds(setMinutes(setHours(new Date(afterLocal), hours), minutes), 0),
    0
  );
  const scheduledTimeStillAhead = afterLocal < scheduledTimeToday;

  if (todayIsCorrectDay && scheduledTimeStillAhead) {
    target = scheduledTimeToday;
  } else {
    target = nextDay(afterLocal, dayIndex);
    target = setHours(target, hours);
    target = setMinutes(target, minutes);
    target = setSeconds(target, 0);
    target = setMilliseconds(target, 0);
  }

  const allExcluded = new Set([
    ...(skipDates ?? []).map((d) => d.slice(0, 10)),
    ...(cancelledDates ?? []).map((d) => d.slice(0, 10)),
  ]);

  // toIsoDateStr uses local JS date components, which here represent league-local
  // time because target was computed from afterLocal (league-local).
  let iterations = 0;
  while (allExcluded.size > 0 && iterations < 60) {
    const dateStr = toIsoDateStr(target);
    if (!allExcluded.has(dateStr)) break;
    target = addWeeks(target, 1);
    iterations++;
  }

  // Convert league-local time representation back to UTC for storage
  return fromZonedTime(target, timezone);
}
