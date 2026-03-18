import { addWeeks } from "date-fns";

export function toIsoDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function toLocalMidnight(date: string | Date): Date {
  if (typeof date === "string") {
    const [year, month, day] = date.split("T")[0].split("-").map(Number);
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

export function calculateSeasonEnd(
  seasonStart: string | Date,
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
    return toLocalMidnight(seasonStart);
  }

  let current = toLocalMidnight(seasonStart);
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
  totalBowlingWeeks: number,
  skipDates: string[],
  cancelledDates: string[]
): ScheduleWeek[] {
  const skipSet = new Set((skipDates ?? []).map((d) => d.slice(0, 10)));
  const cancelSet = new Set((cancelledDates ?? []).map((d) => d.slice(0, 10)));

  const effectiveWeeks = getEffectiveBowlingWeeks(totalBowlingWeeks, cancelledDates ?? []);
  const result: ScheduleWeek[] = [];

  let current = toLocalMidnight(seasonStart);
  let bowlingWeekNumber = 0;
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

    const weekNum = !isSkip && !isCancelled ? ++bowlingWeekNumber : null;

    result.push({
      date: new Date(current),
      isoDate: dateStr,
      type,
      bowlingWeekNumber: weekNum,
    });

    if (!isSkip && !isCancelled && bowlingWeekNumber >= effectiveWeeks) break;
    current = addWeeks(current, 1);
  }

  return result;
}

export function getBowlingWeekNumber(
  date: Date,
  seasonStart: string | Date,
  skipDates: string[],
  cancelledDates: string[]
): number {
  const skipSet = new Set((skipDates ?? []).map((d) => d.slice(0, 10)));
  const cancelSet = new Set((cancelledDates ?? []).map((d) => d.slice(0, 10)));
  const allExcluded = new Set([...skipSet, ...cancelSet]);

  const targetStr = toIsoDateStr(date);
  let current = toLocalMidnight(seasonStart);
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
  skipDates: string[],
  cancelledDates: string[]
): number {
  const skipSet = new Set((skipDates ?? []).map((d) => d.slice(0, 10)));
  const cancelSet = new Set((cancelledDates ?? []).map((d) => d.slice(0, 10)));
  const allExcluded = new Set([...skipSet, ...cancelSet]);

  const today = toLocalMidnight(new Date());
  const todayStr = toIsoDateStr(today);
  let current = toLocalMidnight(seasonStart);
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
