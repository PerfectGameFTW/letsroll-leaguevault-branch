import { addWeeks } from "date-fns";

const WEEKDAY_MAP: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
  Thursday: 4, Friday: 5, Saturday: 6,
};

export function toIsoDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function toLocalMidnight(date: string | Date): Date {
  if (typeof date === "string") {
    const datePart = date.replace(" ", "T").split("T")[0];
    const [year, month, day] = datePart.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  return d;
}

export type ScheduleWeek = {
  date: Date;
  isoDate: string;
  type: "normal" | "skip" | "cancelled";
  bowlingWeekNumber: number | null;
};

export function getEffectiveBowlingWeeks(
  totalBowlingWeeks: number,
  cancelledDates: string[]
): number {
  return Math.max(0, totalBowlingWeeks - (cancelledDates?.length ?? 0));
}

function findFirstBowlingDay(seasonStart: string | Date, weekDay: string): Date {
  const targetDay = WEEKDAY_MAP[weekDay];
  let start = toLocalMidnight(seasonStart);

  if (targetDay === undefined) return start;

  const startDay = start.getDay();
  const daysToAdd = (targetDay - startDay + 7) % 7;
  if (daysToAdd > 0) {
    start = new Date(start.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
  }
  return start;
}

export function calculateSeasonEnd(
  seasonStart: string | Date,
  weekDay: string,
  totalBowlingWeeks: number,
  skipDates: string[],
  cancelledDates: string[]
): Date {
  if (totalBowlingWeeks <= 0) return toLocalMidnight(seasonStart);

  const skipSet = new Set((skipDates ?? []).map((d) => d.slice(0, 10)));
  const cancelSet = new Set((cancelledDates ?? []).map((d) => d.slice(0, 10)));
  const allExcluded = new Set([...skipSet, ...cancelSet]);

  const effectiveWeeks = getEffectiveBowlingWeeks(totalBowlingWeeks, cancelledDates ?? []);
  if (effectiveWeeks <= 0) {
    return findFirstBowlingDay(seasonStart, weekDay);
  }

  let current = findFirstBowlingDay(seasonStart, weekDay);
  let found = 0;
  let lastBowlingDate = new Date(current);
  const maxIter = totalBowlingWeeks + allExcluded.size + 60;

  for (let i = 0; i < maxIter; i++) {
    const dateStr = toIsoDateStr(current);
    if (!allExcluded.has(dateStr)) {
      found++;
      lastBowlingDate = new Date(current);
      if (found >= effectiveWeeks) break;
    }
    current = addWeeks(current, 1);
  }

  return lastBowlingDate;
}

export function getAllBowlingDates(
  seasonStart: string | Date,
  weekDay: string,
  totalBowlingWeeks: number,
  skipDates: string[],
  cancelledDates: string[]
): ScheduleWeek[] {
  const skipSet = new Set((skipDates ?? []).map((d) => d.slice(0, 10)));
  const cancelSet = new Set((cancelledDates ?? []).map((d) => d.slice(0, 10)));

  // Key semantics:
  //   • Skip  → holiday; season EXTENDS (skip does NOT consume a planned slot)
  //   • Cancelled → no makeup; season SHORTENS (cancelled DOES consume a planned slot)
  //
  // Therefore the planned calendar window contains exactly:
  //   totalBowlingWeeks non-skip dates (normal + cancelled),
  //   plus any additional skip weeks inserted inside that window.
  //
  // Every cancelled date IS inside the window and must always appear in the
  // list so admins can toggle it back to Normal or Skip at any time.

  const result: ScheduleWeek[] = [];
  let current = findFirstBowlingDay(seasonStart, weekDay);
  let bowlingWeekNumber = 0;
  // slots = normal + cancelled rows emitted (skips don't count toward the window)
  let slotsConsumed = 0;
  const maxIter = totalBowlingWeeks + skipSet.size + cancelSet.size + 60;

  for (let i = 0; i < maxIter; i++) {
    const dateStr = toIsoDateStr(current);
    const isSkip = skipSet.has(dateStr);
    const isCancelled = cancelSet.has(dateStr);
    const type: ScheduleWeek["type"] = isSkip
      ? "skip"
      : isCancelled
      ? "cancelled"
      : "normal";

    // Only normal dates get a bowling week number
    const weekNum = !isSkip && !isCancelled ? ++bowlingWeekNumber : null;

    // Both normal and cancelled rows consume a planned slot
    if (!isSkip) slotsConsumed++;

    result.push({ date: new Date(current), isoDate: dateStr, type, bowlingWeekNumber: weekNum });

    // Stop once all planned slots are consumed
    if (slotsConsumed >= totalBowlingWeeks) break;

    current = addWeeks(current, 1);
  }

  return result;
}

export function getBowlingWeekNumber(
  date: Date,
  seasonStart: string | Date,
  weekDay: string,
  skipDates: string[],
  cancelledDates: string[]
): number {
  const skipSet = new Set((skipDates ?? []).map((d) => d.slice(0, 10)));
  const cancelSet = new Set((cancelledDates ?? []).map((d) => d.slice(0, 10)));
  const allExcluded = new Set([...skipSet, ...cancelSet]);

  const targetStr = toIsoDateStr(date);
  let current = findFirstBowlingDay(seasonStart, weekDay);
  let weekNum = 0;
  const maxIter = 200;

  for (let i = 0; i < maxIter; i++) {
    const dateStr = toIsoDateStr(current);
    if (!allExcluded.has(dateStr)) {
      weekNum++;
    }
    if (dateStr === targetStr) return weekNum;
    current = addWeeks(current, 1);
  }

  return weekNum;
}

export function countBowlingWeeksPassed(
  seasonStart: string | Date,
  weekDay: string,
  skipDates: string[],
  cancelledDates: string[]
): number {
  const skipSet = new Set((skipDates ?? []).map((d) => d.slice(0, 10)));
  const cancelSet = new Set((cancelledDates ?? []).map((d) => d.slice(0, 10)));
  const allExcluded = new Set([...skipSet, ...cancelSet]);

  const today = toLocalMidnight(new Date());
  const todayStr = toIsoDateStr(today);
  let current = findFirstBowlingDay(seasonStart, weekDay);
  let weekNum = 0;
  const maxIter = 200;

  for (let i = 0; i < maxIter; i++) {
    const dateStr = toIsoDateStr(current);
    if (dateStr > todayStr) break;
    if (!allExcluded.has(dateStr)) {
      weekNum++;
    }
    current = addWeeks(current, 1);
  }

  return weekNum;
}

export function getBowlingDateByWeekNumber(
  seasonStart: string | Date,
  weekDay: string,
  weekNumber: number,
  skipDates: string[],
  cancelledDates: string[]
): Date | null {
  if (weekNumber <= 0) return null;

  const skipSet = new Set((skipDates ?? []).map((d) => d.slice(0, 10)));
  const cancelSet = new Set((cancelledDates ?? []).map((d) => d.slice(0, 10)));
  const allExcluded = new Set([...skipSet, ...cancelSet]);

  let current = findFirstBowlingDay(seasonStart, weekDay);
  let weekNum = 0;
  const maxIter = weekNumber + allExcluded.size + 60;

  for (let i = 0; i < maxIter; i++) {
    const dateStr = toIsoDateStr(current);
    if (!allExcluded.has(dateStr)) {
      weekNum++;
      if (weekNum >= weekNumber) return new Date(current);
    }
    current = addWeeks(current, 1);
  }

  return null;
}

export function isDateSkippedOrCancelled(
  date: Date,
  skipDates: string[],
  cancelledDates: string[]
): boolean {
  const dateStr = toIsoDateStr(date);
  return (
    (skipDates ?? []).some((d) => d.slice(0, 10) === dateStr) ||
    (cancelledDates ?? []).some((d) => d.slice(0, 10) === dateStr)
  );
}
