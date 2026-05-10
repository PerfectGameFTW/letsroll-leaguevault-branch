import { startOfToday, isValid } from "date-fns";
import {
  getEffectiveBowlingWeeks,
  countBowlingWeeksPassed,
  toIsoDateStr,
} from "./schedule-utils";

export interface BowlerPastDueLeague {
  seasonStart: string | Date;
  seasonEnd?: string | Date | null;
  weekDay?: string | null;
  weeklyFee: number;
  paymentMode?: string | null;
  totalBowlingWeeks?: number | null;
  skipDates?: string[] | null;
  cancelledDates?: string[] | null;
  doublePayDates?: string[] | null;
}

function getSeasonLengthWeeks(league: {
  seasonStart: string | Date;
  seasonEnd: string | Date;
  totalBowlingWeeks?: number | null;
  cancelledDates?: string[] | null;
}): number {
  if (!league.seasonStart || !league.seasonEnd) return 0;
  if (league.totalBowlingWeeks != null) {
    return getEffectiveBowlingWeeks(
      league.totalBowlingWeeks,
      league.cancelledDates ?? [],
    );
  }
  const start = new Date(league.seasonStart);
  const end = new Date(league.seasonEnd);
  if (!isValid(start) || !isValid(end)) return 0;
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / msPerWeek));
}

/**
 * Source-of-truth past-due calculation shared by the client UI and the
 * server-side autopay-setup guard. Mirrors the per-bowler past-due
 * shown in the bowler payment page.
 */
export function calculateBowlerPastDue(
  league: BowlerPastDueLeague,
  bowlerPaidAmount: number,
): number {
  const doublePayDates = (league.doublePayDates ?? [])
    .map((d) => d.slice(0, 10))
    .filter(Boolean);

  if (league.paymentMode === "upfront") {
    const totalWeeks = getSeasonLengthWeeks({
      seasonStart: league.seasonStart,
      seasonEnd: league.seasonEnd ?? league.seasonStart,
      totalBowlingWeeks: league.totalBowlingWeeks,
      cancelledDates: league.cancelledDates,
    });
    const fullSeasonAmount =
      league.weeklyFee * totalWeeks + doublePayDates.length * league.weeklyFee;
    return Math.max(0, fullSeasonAmount - bowlerPaidAmount);
  }

  const today = startOfToday();
  const todayStr = toIsoDateStr(today);
  const pastExtra =
    doublePayDates.filter((d) => d <= todayStr).length * league.weeklyFee;

  // Cap due-to-date at the full season amount so a season that has
  // already ended doesn't keep inflating past-due as time marches on.
  // Mirrors `calculateFinancials.totalDueToDate = Math.min(raw, fullSeasonAmount)`
  // on the bowler-page side; without this cap the past-due report and
  // the bowler page disagree once the season is over (Task #726 follow-up).
  const totalWeeks = getSeasonLengthWeeks({
    seasonStart: league.seasonStart,
    seasonEnd: league.seasonEnd ?? league.seasonStart,
    totalBowlingWeeks: league.totalBowlingWeeks,
    cancelledDates: league.cancelledDates,
  });
  const fullSeasonAmount =
    league.weeklyFee * totalWeeks + doublePayDates.length * league.weeklyFee;

  if (league.totalBowlingWeeks != null && league.weekDay) {
    const weeksPassedRaw = countBowlingWeeksPassed(
      league.seasonStart,
      league.weekDay,
      league.skipDates ?? [],
      league.cancelledDates ?? [],
    );
    const weeksPassed = Math.min(weeksPassedRaw, totalWeeks);
    const dueToDate = Math.min(
      league.weeklyFee * weeksPassed + pastExtra,
      fullSeasonAmount,
    );
    return Math.max(0, dueToDate - bowlerPaidAmount);
  }

  const seasonStart = new Date(league.seasonStart);
  if (!isValid(seasonStart)) return 0;
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weeksPassedRaw = Math.max(
    0,
    Math.round((today.getTime() - seasonStart.getTime()) / msPerWeek),
  );
  const weeksPassed = Math.min(weeksPassedRaw, totalWeeks);
  const dueToDate = Math.min(
    league.weeklyFee * weeksPassed + pastExtra,
    fullSeasonAmount,
  );
  return Math.max(0, dueToDate - bowlerPaidAmount);
}
