import { addWeeks, nextDay, setHours, setMinutes, setSeconds, setMilliseconds } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';

const WEEKDAY_MAP: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
  Thursday: 4, Friday: 5, Saturday: 6,
};

export function getNextLeagueDateTime(
  afterDate: Date,
  weekDay: string,
  competitionStartTime: string | null | undefined,
  timezone: string = 'America/Chicago'
): Date {
  const [hours, minutes] = competitionStartTime
    ? competitionStartTime.split(':').map(Number)
    : [12, 0];

  const dayIndex = WEEKDAY_MAP[weekDay];
  if (dayIndex === undefined) {
    return addWeeks(afterDate, 1);
  }

  let target = nextDay(afterDate, dayIndex);
  target = setHours(target, hours);
  target = setMinutes(target, minutes);
  target = setSeconds(target, 0);
  target = setMilliseconds(target, 0);

  return fromZonedTime(target, timezone);
}
